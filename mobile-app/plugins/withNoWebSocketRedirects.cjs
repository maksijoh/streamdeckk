const { withMainApplication } = require('expo/config-plugins');

const previousStatement = 'WebSocketModule.setCustomClientBuilder { builder -> builder.followRedirects(false).followSslRedirects(false) }';
// OkHttp 4.9.2 exits callTimeout when the upgrade succeeds; established sockets
// keep RN's unlimited read timeout. Abort stalled native handshakes before JS retries at 25s.
const statement = 'WebSocketModule.setCustomClientBuilder { builder -> builder.followRedirects(false).followSslRedirects(false).callTimeout(20, java.util.concurrent.TimeUnit.SECONDS) }';

function disableRedirects(source) {
  const start = /(override fun onCreate\(\)\s*\{\s*super\.onCreate\(\))/;
  const packageLine = /^(package [^\r\n]+\r?\n)/m;
  if (!start.test(source) || !packageLine.test(source)) {
    throw new Error('DeckRemote could not disable native WebSocket redirects: MainApplication template changed.');
  }
  if (source.includes(statement)) return source;
  if (source.includes(previousStatement)) return source.replace(previousStatement, statement);
  return source.replace(packageLine, '$1\nimport com.facebook.react.modules.websocket.WebSocketModule\n')
    .replace(start, `$1\n    ${statement}`);
}

module.exports = config => withMainApplication(config, mod => {
  if (mod.modResults.language !== 'kt') throw new Error('DeckRemote requires a Kotlin MainApplication to disable WebSocket redirects.');
  mod.modResults.contents = disableRedirects(mod.modResults.contents);
  return mod;
});
module.exports.disableRedirects = disableRedirects;
