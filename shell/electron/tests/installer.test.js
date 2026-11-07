const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'),path=require('node:path');
const fs=require('node:fs'),os=require('node:os');
test('installer help and invalid options do not start a build',()=>{
 const script=path.resolve(__dirname,'../../../packaging/install.sh');
 assert.equal(spawnSync('bash',[script,'--help']).status,0);
 assert.equal(spawnSync('bash',[script,'--unknown']).status,2);
});
test('installed launcher discovers a custom app directory through its symlink',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'deepdeck-launcher-'));
 try {
  const app=path.join(root,'custom app'),bin=path.join(root,'bin');
  fs.mkdirSync(path.join(app,'packaging/bin'),{recursive:true});fs.mkdirSync(path.join(app,'shell/electron'),{recursive:true});fs.mkdirSync(bin);
  fs.copyFileSync(path.resolve(__dirname,'../../../packaging/bin/DeepDeck'),path.join(app,'packaging/bin/DeepDeck'));
  fs.chmodSync(path.join(app,'packaging/bin/DeepDeck'),0o755);fs.writeFileSync(path.join(app,'shell/electron/main.js'),'');
  const electron=path.join(root,'electron');fs.writeFileSync(electron,'#!/bin/sh\nprintf "%s" "$1"\n',{mode:0o755});
  fs.symlinkSync(path.join(app,'packaging/bin/DeepDeck'),path.join(bin,'DeepDeck'));
  const result=spawnSync(path.join(bin,'DeepDeck'),[],{encoding:'utf8',env:{...process.env,DEEPDECK_HOME:'',DEEPDECK_ELECTRON:electron,XDG_CONFIG_HOME:path.join(root,'config')}});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,path.join(app,'shell/electron'));
  const node=path.join(bin,'node');fs.writeFileSync(node,'#!/bin/sh\nexit 0\n',{mode:0o755});
  fs.writeFileSync(electron,'#!/bin/sh\ncommand -v node\n');
  const selected=spawnSync(path.join(bin,'DeepDeck'),[],{encoding:'utf8',env:{...process.env,HOME:root,DEEPDECK_HOME:'',DEEPDECK_ELECTRON:electron,XDG_CONFIG_HOME:path.join(root,'config'),PATH:bin+':'+process.env.PATH}});
  assert.equal(selected.status,0,selected.stderr);assert.equal(selected.stdout.trim(),node);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
