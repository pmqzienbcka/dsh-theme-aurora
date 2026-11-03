/**
 * Host half of the Aurora theme bundle.
 *
 * One local route on the Harness web server:
 *
 *   GET /aurora/fonts -> { fonts: [{ family, label }], source: 'host' }
 *
 * `family` is the value CSS consumes; `label` is the localized display name.
 * The browser cannot enumerate installed fonts, so the Host reads the Windows
 * font directories and hands the list to the settings page.
 *
 * Everything visual lives in `client.js`.
 */
import { listFonts } from './lib/fonts.mjs'

export const name = 'dsh-theme-aurora'

function sendJson(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(() =>
      scoped.webServer.register({
        kind: 'exact',
        path: '/aurora/fonts',
        handler: (_req, res) => {
          try {
            sendJson(res, 200, { fonts: listFonts(), source: 'host' })
          } catch (error) {
            sendJson(res, 500, { fonts: [], error: String(error?.message ?? error) })
          }
        },
      }),
    )
  })
}
