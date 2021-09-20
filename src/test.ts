import { RustPlus } from './rustplus'

main().catch((e) => console.error(e))

async function main() {
  var rustplus = new RustPlus(
    '164.132.206.193',
    '28229',
    '76561198011675847',
    +'371121738'
  )

  rustplus.on('connected', () => {
    console.info('connected sync')
  })

  await rustplus.connect()
  console.info('connected async')
  console.info(await rustplus.getTeamInfo())
}
