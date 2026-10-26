// Build only isolated test installers. Baseline sources should be an extracted git archive.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root=fileURLToPath(new URL('..',import.meta.url)), output=resolve(root,'release-acceptance')
const baseline=resolve(root,process.argv[2]??'release-acceptance/baseline-source')
if(!baseline.startsWith(output+sep))throw Error('Baseline must be inside the dedicated release-acceptance directory')
const identity={appId:'com.holyxie.novelprompt.acceptance',productName:'NovelPrompt Acceptance',createDesktopShortcut:false,createStartMenuShortcut:false,runAfterFinish:false}
async function run(args,cwd){const child=spawn(process.execPath,args,{cwd,windowsHide:true,stdio:'inherit'});const [code]=await once(child,'exit');if(code!==0)throw Error('Build failed: '+code)}
for(const [label,cwd,folder] of [['baseline',baseline,'baseline-local'],['current',root,'current']]) {
  const target=join(output,folder);if(!target.startsWith(output+sep))throw Error('Unsafe build target')
  mkdirSync(target,{recursive:true})
  await run([join(root,'node_modules/electron-vite/bin/electron-vite.js'),'build'],cwd)
  const name=`NovelPrompt-Acceptance-${label}.exe`
  await run([join(root,'node_modules/electron-builder/cli.js'),'--win','nsis','--x64','--publish','never',
    `--config.electronDist=${join(root,'node_modules/electron/dist')}`,`--config.directories.output=${target}`,
    `--config.appId=${identity.appId}`,`--config.productName=${identity.productName}`,
    '--config.nsis.createDesktopShortcut=false','--config.nsis.createStartMenuShortcut=false','--config.nsis.runAfterFinish=false',
    `--config.nsis.artifactName=${name}`,...(label==='current'?['--config.extraMetadata.version=0.6.1-acceptance.1']:[])],cwd)
  writeFileSync(join(target,'acceptance-build.json'),JSON.stringify({...identity,installer:name,sha256:createHash('sha256').update(readFileSync(join(target,name))).digest('hex')},null,2))
}
