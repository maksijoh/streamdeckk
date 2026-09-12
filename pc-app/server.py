"""One authenticated receive loop per phone; bounded background action dispatch."""
import asyncio
import functools
import json
import logging
import time

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from actions import UnsupportedAction, execute
from config import load_config
from pairing import Revoked
from protocol import CLIENT, MAX_SIZE, ack, correlatable, decode, encode

LOG = logging.getLogger("deckremote")
# Library DEBUG traces contain handshake URLs. Never forward those records.
WIRE_LOG = logging.getLogger("deckremote.wire")
WIRE_LOG.disabled = True


def event(name, **fields):
    LOG.info(json.dumps({"event": name, **fields}, separators=(",", ":")))


class Service:
    def __init__(self, tokens, config_path, runner=execute):
        self.tokens = tokens
        self.config_path = config_path
        self.config, self.actions = load_config(config_path)
        self.runner = runner
        self.clients = {}
        self.slots = asyncio.Semaphore(8)
        self.tasks = set()
        self.server = None

    async def start(self, host, port):
        self.server = await serve(self.handle, host, port, max_size=MAX_SIZE, max_queue=16,
                                  ping_interval=None, close_timeout=2, compression=None,
                                  logger=WIRE_LOG, origins=None)
        event("started", host=host, port=self.server.sockets[0].getsockname()[1])
        return self.server

    async def stop(self):
        if self.server:
            self.server.close()
            await self.server.wait_closed()
        # Already-started work is allowed to finish; scripts have a bounded timeout.
        if self.tasks:
            await asyncio.gather(*list(self.tasks), return_exceptions=True)
        event("stopped")

    async def rotate(self):
        generation = self.tokens.rotate()  # Persistence failure never changes active state.
        old = [client for client, auth_generation in self.clients.items() if auth_generation != generation]
        await asyncio.gather(*(client.close(4001, "Invalid token") for client in old), return_exceptions=True)
        event("token_regenerated")

    async def reload(self):
        message, actions = load_config(self.config_path, self.config["revision"])
        changed = message["buttons"] != self.config["buttons"]
        if changed:
            message["revision"] += 1
            encode(message)
        self.config, self.actions = message, actions
        if changed:
            await asyncio.gather(*(self.send(client, message) for client in list(self.clients)), return_exceptions=True)
        event("config_reloaded", revision=message["revision"])

    async def send(self, client, message):
        try:
            await asyncio.wait_for(client.send(encode(message)), timeout=5)
        except (ConnectionClosed, asyncio.TimeoutError):
            await client.close(1001, "Connection unavailable")

    async def press(self, client, generation, message, action):
        code = None
        try:
            async with self.slots:
                if client not in self.clients or generation != self.tokens.generation:
                    return
                if action is None:
                    code = "unknown_button"
                else:
                    authorized = functools.partial(self.tokens.authorized, generation)
                    await asyncio.to_thread(self.runner, action, authorized)
        except Revoked:
            return
        except UnsupportedAction:
            code = "unsupported_action"
        except Exception as error:
            code = "action_failed"
            event("action_error", requestId=message["requestId"], errorType=type(error).__name__)
        event("action_result", requestId=message["requestId"], buttonId=message["buttonId"], result=code or "ok")
        await self.send(client, ack(message, code))

    async def handle(self, client):
        pending = set()
        generation = self.tokens.generation
        failure = self.tokens.authenticate(client.request.path)
        if failure:
            await client.close(*failure)
            event("connection_rejected", code=failure[0])
            return
        self.clients[client] = generation
        event("connected", clientId=str(client.id))
        try:
            # Registration and first config have no intervening await: rotation sees us.
            await self.send(client, self.config)
            async for raw in client:
                if generation != self.tokens.generation:
                    await client.close(4001, "Invalid token")
                    break
                if isinstance(raw, bytes):
                    await client.close(1003, "Text messages required")
                    break
                try:
                    message = decode(raw)
                except (ValueError, RecursionError):
                    await client.close(1008, "Invalid message")
                    break
                if not CLIENT.is_valid(message):
                    if correlatable(message):
                        await self.send(client, ack(message, "invalid_message"))
                        continue
                    await client.close(1008, "Invalid message")
                    break
                if message["type"] == "ping":
                    await self.send(client, {"type": "pong", "requestId": message["requestId"], "ts": time.time_ns() // 1_000_000})
                else:
                    event("press", clientId=str(client.id), requestId=message["requestId"], buttonId=message["buttonId"])
                    # ponytail: cap each phone at 32 outstanding actions; add fair scheduling if contention matters.
                    if len(pending) >= 32:
                        await self.send(client, ack(message, "action_failed"))
                        continue
                    task = asyncio.create_task(self.press(client, generation, message, self.actions.get(message["buttonId"])))
                    pending.add(task)
                    self.tasks.add(task)
                    task.add_done_callback(pending.discard)
                    task.add_done_callback(self.tasks.discard)
        except ConnectionClosed:
            pass
        finally:
            self.clients.pop(client, None)
            event("disconnected", clientId=str(client.id))
