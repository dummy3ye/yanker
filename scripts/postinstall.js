import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import https from 'node:https'

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, response => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          return downloadFile(response.headers.location, dest).then(resolve).catch(reject)
        }
        if (response.statusCode !== 200) return reject(new Error(`Status ${response.statusCode}`))
        const file = fs.createWriteStream(dest)
        response.pipe(file)
        file.on('finish', () => {
          file.close()
          resolve()
        })
      })
      .on('error', reject)
  })
}

async function main() {
  const pluginDir = path.join(os.homedir(), '.config', 'yt-dlp', 'plugins')
  const serverDir = path.join(os.homedir(), '.yanker', 'pot-provider')

  try {
    console.log('Installing bgutil-ytdlp-pot-provider plugin...')
    await fsp.mkdir(pluginDir, { recursive: true })
    await downloadFile(
      'https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip',
      path.join(pluginDir, 'bgutil-ytdlp-pot-provider.zip'),
    )

    console.log('Installing bgutil-ytdlp-pot-provider server...')
    if (!fs.existsSync(serverDir)) {
      await fsp.mkdir(path.dirname(serverDir), { recursive: true })
      execSync(
        `git clone --single-branch --branch 2.0.0 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "${serverDir}"`,
        { stdio: 'inherit' },
      )
    }
    console.log('Building server...')
    execSync(`npm ci && npx tsc`, { cwd: path.join(serverDir, 'server'), stdio: 'inherit' })
    console.log('Done.')
  } catch (e) {
    console.error('Failed to setup POT provider:', e.message)
  }
}
main()
