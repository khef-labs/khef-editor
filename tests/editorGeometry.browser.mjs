import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

if (process.platform !== 'darwin') throw new Error('This Electron regression currently requires macOS')
await fs.mkdir('shadow', { recursive: true })
const dir = await fs.mkdtemp(path.resolve('shadow/editor-geometry-'))
const server=createServer()
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const port=server.address().port
await new Promise(r=>server.close(r))
const files = path.join(dir, 'files')
await fs.mkdir(files, { recursive: true })
const sentence = 'A wrapped paragraph exercises editor measurements, selections, and scrolling. '
await fs.writeFile(path.join(files, 'wrapped.md'), Array.from({ length: 160 }, (_, i) =>
  i > 28 && i < 45 ? '' : `${i + 1}. ${sentence.repeat(i % 8 + 1)}`).join('\n'))
await fs.writeFile(path.join(files, 'long.md'), Array.from({ length: 2400 }, (_, i) =>
  `${i + 1}. ${sentence.repeat(i % 12 + 1)}`).join('\n'))
await fs.writeFile(path.join(files, 'short.md'), '# Short document\n\nOne short line.\n')
await fs.writeFile(path.join(files, 'long-line.md'), '# Long line\n\n' + sentence.repeat(1500) + '\n\nEnd.\n')
for (const count of [9, 99]) {
  await fs.writeFile(path.join(files, `spacer-${count}.txt`),
    Array.from({ length: count }, (_, i) => `Line ${i + 1}`).join('\n'))
}

const log = await fs.open(path.join(dir, 'electron.log'), 'a')
const child = spawn(path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  [path.resolve('tests/browser/editorGeometry-main.cjs'), `--remote-debugging-port=${port}`],
  { env: {...process.env,KE_GEOMETRY_PROFILE:path.join(dir,'profile')}, stdio: ['ignore',log.fd,log.fd] })
console.log(`Scratch KE PID ${child.pid}; fixtures: ${files}`)
let launchError
child.on('error', error => { launchError = error })
let socket
try {
let targets
for (let i = 0; i < 100; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some(t => t.type === 'page')) break } catch {}
  if (launchError) throw launchError
  if (child.exitCode != null) throw new Error(`Scratch KE exited ${child.exitCode}; see electron.log`)
  await delay(100)
}
const target = targets?.find(t => t.type === 'page' && t.url.includes('dist/index.html'))
if (!target) throw new Error('No scratch KE page found')
socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
let id = 0
const pending = new Map()
const errors = []
const anomalies = []
socket.onmessage = ({ data }) => {
  const m = JSON.parse(data)
  if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) }
  else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails)
}
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id
  const timer = setTimeout(() => {
    pending.delete(n)
    reject(new Error(`CDP timed out: ${method}`))
  }, 15000)
  pending.set(n, {
    resolve: result => { clearTimeout(timer); resolve(result) },
    reject: error => { clearTimeout(timer); reject(error) },
  })
  socket.send(JSON.stringify({ id: n, method, params }))
})
const evaluate = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result.value
}
await send('Runtime.enable')
await send('Page.reload')
await delay(800)
await evaluate(`window.editorApi.openWorkspace(${JSON.stringify(files)})`)
// Let App rehydrate the main-owned workspace through its normal reload path.
await send('Page.reload')
await delay(800)
await evaluate(`if(!document.querySelector('.filetree'))document.querySelector('button[title="Explorer"]')?.click()` )
await delay(200)
const tree = await evaluate(`Array.from(document.querySelectorAll('[data-testid], [title]')).filter(e => /wrapped|short|long/.test(e.textContent?.trim() || '') && (e.textContent?.length || 0)<100).map(e => ({tag:e.tagName,testid:e.getAttribute('data-testid'),title:e.title,text:e.textContent}))`)
await fs.writeFile(path.join(dir, 'tree.json'), JSON.stringify(tree, null, 2))

const clickFile = async name => {
  const ok = await evaluate(`(() => {
    const tab=document.querySelector('[data-testid="tab-${name}"]');
    if(tab){tab.click();return true}
    const e=Array.from(document.querySelectorAll('.tree-file, .tree-row, [data-testid]')).find(e=>e.textContent?.trim()===${JSON.stringify(name)});
    if(e){e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));e.click();return true}return false
  })()`)
  if (!ok) throw new Error(`Could not open ${name}; inspect tree.json`)
  await delay(80)
}
await clickFile('wrapped.md')
// Electron does not expose the Browser window-control domain; resize the renderer viewport.
const check = async label => {
  const result = await evaluate(`(() => {
    const issues=[];
    for(const content of document.querySelectorAll('.cm-content')){
      const v=content.cmTile?.root?.view;
      if(!v){issues.push({kind:'missing-view'});continue}
      const sc=v.scrollDOM.getBoundingClientRect();
      const gutter=v.dom.querySelector('.cm-lineNumbers');
      for(const e of gutter?.children || []){
        if(e.style.visibility==='hidden')continue;
        const n=Number(e.textContent);const r=e.getBoundingClientRect();
        if(!Number.isInteger(n)||n<1||n>v.state.doc.lines||r.top<sc.top||r.bottom>sc.bottom)continue;
        const pos=v.state.doc.line(n).from,c=v.coordsAtPos(pos);
        if(c&&Math.abs(c.top-r.top)>10)issues.push({kind:'gutter-offset',line:n,delta:c.top-r.top});
      }
      for(const range of v.visibleRanges){
        let line=v.state.doc.lineAt(range.from),count=0;
        while(line.from<=range.to&&count++<40){
          const c=v.coordsAtPos(line.from);
          if(c&&c.top>=sc.top&&c.bottom<=sc.bottom&&c.left>=sc.left&&c.left<sc.right){
            const hit=v.posAtCoords({x:c.left+1,y:(c.top+c.bottom)/2});
            if(hit!=null&&v.state.doc.lineAt(hit).number!==line.number)issues.push({kind:'hit-test',line:line.number,hitLine:v.state.doc.lineAt(hit).number});
          }
          if(line.number===v.state.doc.lines)break;line=v.state.doc.line(line.number+1)
        }
      }
    }
    return {issues,editors:document.querySelectorAll('.cm-editor').length,lines:Array.from(document.querySelectorAll('.cm-content')).map(c=>c.cmTile?.root?.view?.state.doc.lines)}
  })()`)
  if(result.issues.length){
    anomalies.push({label,...result})
    if(anomalies.length===1){
      await fs.writeFile(path.join(dir,'failure.json'),JSON.stringify({label,...result,errors},null,2))
      const shot=await send('Page.captureScreenshot');await fs.writeFile(path.join(dir,'failure.png'),Buffer.from(shot.data,'base64'))
      console.log('Captured layout anomaly: '+JSON.stringify(result.issues.slice(0,3)))
    }
    if(result.issues.some(i=>i.kind==='hit-test')) throw new Error('Mouse-position mapping failure at '+label)
  }
  return result
}
await check('baseline')
for(let i=0;i<100;i++){
  const name=['wrapped.md','long.md','short.md','long-line.md'][i%4]
  await clickFile(name)
  await send('Emulation.setDeviceMetricsOverride',{width:[760,1280,960,1500][i%4],height:[500,820,630][i%3],deviceScaleFactor:[1,2][i%2],mobile:false})
  await evaluate(`(() => {for(const e of document.querySelectorAll('.cm-scroller'))e.scrollTop=${i%5===0?'e.scrollHeight':String((i*317)%12000)}})()`)
  if(i%6===0){await send('Input.dispatchKeyEvent',{type:'keyDown',key:'b',code:'KeyB',modifiers:4});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'b',code:'KeyB',modifiers:4})}
  await delay(120)
  await check('iteration '+i+' '+name)
  if(i%10===0)console.log(`Passed ${i+1}/100 layout cycles`)
}
const shot=await send('Page.captureScreenshot');await fs.writeFile(path.join(dir,'final.png'),Buffer.from(shot.data,'base64'))
await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({cycles:100,errors,anomalies,result:anomalies.length?'Gutter alignment anomaly reproduced; no mouse-position mismatch detected':'No geometry failure reproduced'},null,2))
assert.equal(anomalies.length,0,'Gutter alignment and mouse mapping must survive layout cycles')
assert.equal(errors.length,0,'Renderer must not throw')

// A hidden gutter-width spacer is labelled 9/99. At exactly those document
// lengths, treating it as a visible line would cause a needless gutter rebuild.
for (const count of [9, 99]) {
  await clickFile(`spacer-${count}.txt`)
  await evaluate(`(() => {
    const v=document.querySelector('.cm-content').cmTile.root.view;
    v.scrollDOM.scrollTop=0;
  })()`)
  await delay(250)
  const spacer = await evaluate(`(() => {
    const v=document.querySelector('.cm-content').cmTile.root.view;
    window.__spacerGutter=v.dom.querySelector('.cm-lineNumbers');
    const spacer=Array.from(window.__spacerGutter.children).find(e=>e.style.visibility==='hidden');
    return {lines:v.state.doc.lines, label:spacer?.textContent, hidden:!!spacer};
  })()`)
  assert.equal(spacer.lines, count)
  assert.equal(spacer.label, String(count))
  assert.equal(spacer.hidden, true)
  await evaluate(`(() => {
    const v=document.querySelector('.cm-content').cmTile.root.view;
    v.dispatch({changes:{from:0,to:1,insert:'X'},userEvent:'input.type'});
  })()`)
  await delay(350)
  assert.equal(await evaluate(`document.querySelector('.cm-lineNumbers')===window.__spacerGutter`),
    true, `${count}-line width spacer must not trigger gutter reconfiguration`)
  await check(`hidden width spacer, ${count} lines`)
}


await evaluate(`(() => {
  const row=document.querySelector('[data-testid="tree-row-wrapped.md"]');
  row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));row.click();
})()`)
await delay(250)
await evaluate(`(() => {
 const v=document.querySelector('.cm-content').cmTile.root.view;
 window.__recoveryOriginal=v.state.doc.toString();
 v.dispatch({changes:{from:0,insert:'REPRO UNSAVED EDIT\\n'},selection:{anchor:110,head:150},userEvent:'input.type'});
 v.focus();v.scrollDOM.scrollTop=850;
 window.__snapshot=()=>{const v=document.querySelector('.cm-content').cmTile.root.view,s=v.scrollDOM.getBoundingClientRect();
 const row=Array.from(v.dom.querySelectorAll('.cm-lineNumbers .cm-gutterElement')).find(e=>Number(e.textContent)>0&&e.getBoundingClientRect().top>=s.top);
 return {doc:v.state.doc.toString(),selection:v.state.selection.toJSON(),scrollTop:v.scrollDOM.scrollTop,line:row?.textContent,top:row?.getBoundingClientRect().top,focused:document.activeElement===v.contentDOM,windowFocused:document.hasFocus()};};
})()`)
await delay(500)
const before=await evaluate('window.__snapshot()')
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'p',code:'KeyP',metaKey:true,shiftKey:true,bubbles:true,cancelable:true}))`)
await delay(200)
assert.equal(await evaluate(`!!document.querySelector('[data-testid="command-palette"]')`),true)
assert.equal(await evaluate(`(() => {const row=Array.from(document.querySelectorAll('.qo-item')).find(e=>e.textContent.includes('Reset Editor Rendering'));if(!row||row.classList.contains('disabled'))return false;row.click();return true})()`),true)
await delay(700)
const after=await evaluate('window.__snapshot()')
assert.equal(after.doc,before.doc,'unsaved text preserved')
assert.deepEqual(after.selection,before.selection,'selection preserved')
assert.equal(after.line,before.line,'visible document anchor preserved')
assert.ok(Math.abs(after.top-before.top)<3,'visible row position preserved')
assert.equal(after.focused,true)
await evaluate(`document.querySelector('.cm-content').dispatchEvent(new KeyboardEvent('keydown',{key:'z',code:'KeyZ',keyCode:90,metaKey:true,bubbles:true,cancelable:true}))`)
await delay(250)
assert.equal(await evaluate(`document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()===window.__recoveryOriginal`),true,'undo history preserved')
const results={unsavedText:true,selection:true,visibleAnchor:true,undo:true,focus:true,before:{line:before.line,top:before.top,scrollTop:before.scrollTop},after:{line:after.line,top:after.top,scrollTop:after.scrollTop}}

await fs.writeFile(path.join(dir,'recovery-results.json'),JSON.stringify(results,null,2))
assert.equal(errors.length,0,'Renderer must not throw during spacer or recovery checks')
console.log('PASS: 100 layout cycles, 9/99-line hidden spacers, and rendering-reset state preservation')
} finally {
  socket?.close()
  child.kill('SIGTERM')
  await log.close()
}
