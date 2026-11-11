// Asset packaging only: crop generated cells without repainting or resampling.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const ffmpeg = process.env.ASHEN_FFMPEG || 'C:/msys64/mingw64/bin/ffmpeg.exe';
const sheets = JSON.parse(fs.readFileSync(path.join(root, 'inspection.json'), 'utf8'));
const durations = { idle: [150,150,150,150,150,150], attack: [100,100,80,70,100,160], hurt: [60,60,80,100,110,130], death: [140,140,180,220,240,900] };
const manifest = { version: 1, name: 'Ashen Corridor — blade & bone frame animations', frameSize: [512,512], frameCount: 48, coordinates: 'Top-left origin; pivots in source-frame pixels; source rect order is row-major.', characters: {} };
for (const sheet of sheets) {
  const frames = [];
  const dir = path.join(root, sheet.character, 'frames', sheet.state);
  fs.mkdirSync(dir, { recursive: true });
  for (let i=0; i<6; i++) {
    const x=(i%3)*512, y=Math.floor(i/3)*512;
    const name=String(i+1).padStart(2,'0')+'.png';
    const output=path.join(dir,name);
    const result=spawnSync(ffmpeg,['-v','error','-y','-i',path.join(root,sheet.path),'-vf',`crop=512:512:${x}:${y}`,'-frames:v','1','-pix_fmt','rgba',output],{encoding:'utf8',windowsHide:true});
    if(result.status!==0) throw Error(result.stderr || 'ffmpeg crop failed');
    const bytes=fs.readFileSync(output);
    frames.push({index:i, path:`${sheet.character}/frames/${sheet.state}/${name}`, rect:{x,y,w:512,h:512}, pivot:{x:sheet.pivots[i][0],y:sheet.pivots[i][1]}, bounds:sheet.bounds[i], durationMs:durations[sheet.state][i], sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  }
  manifest.characters[sheet.character] ||= { facing: sheet.character==='blade'?'right':'left', suggestedDisplayCellPx:144, animations:{} };
  manifest.characters[sheet.character].animations[sheet.state] = { sheet:sheet.path, columns:3, rows:2, frameCount:6, loop:sheet.state==='idle', holdLast:sheet.state==='death', impactFrame:sheet.state==='attack'?3:null, frames };
}
fs.writeFileSync(path.join(root,'atlas.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({sheets:sheets.length,frames:manifest.frameCount,atlas:'atlas.json'}));
