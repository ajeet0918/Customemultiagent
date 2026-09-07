const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root=path.resolve(__dirname,'..'); const pkg=require('../package.json');
const folder=`agent-studio-${pkg.version}-linux-${process.arch}`;const output=path.join(root,'dist',folder);
if(process.platform!=='linux')throw new Error('Run this packaging script on Linux.');
fs.mkdirSync(path.join(root,'dist'),{recursive:true});
if(fs.existsSync(output)) fs.rmSync(output,{recursive:true,force:true});
fs.cpSync(path.dirname(require('electron')),output,{recursive:true});
const destination=path.join(output,'resources','app');fs.mkdirSync(destination,{recursive:true});
for(const name of ['src','assets','docs','package.json','package-lock.json','README.md','AGENTS.md'])fs.cpSync(path.join(root,name),path.join(destination,name),{recursive:true});
const dependencies=spawnSync('npm',['ls','--omit=dev','--parseable','--all'],{cwd:root,encoding:'utf8'});
if(dependencies.error||dependencies.status!==0)throw new Error('Install dependencies before packaging: '+(dependencies.error?.message||dependencies.stderr));
const names=new Set();
for(const directory of dependencies.stdout.trim().split('\n')) {
  const relative=path.relative(path.join(root,'node_modules'),directory);
  if(relative.startsWith('..')||path.isAbsolute(relative)||!relative)continue;
  const parts=relative.split(path.sep);names.add(parts[0].startsWith('@')?parts.slice(0,2).join('/'):parts[0]);
}
for(const name of names)fs.cpSync(path.join(root,'node_modules',name),path.join(destination,'node_modules',name),{recursive:true});
const packagedRequire=require('node:module').createRequire(path.join(destination,'package.json'));
for(const name of Object.keys(pkg.dependencies||{})) {
  if(!packagedRequire.resolve(name).startsWith(path.join(destination,'node_modules')+path.sep))throw new Error(`Packaged dependency missing: ${name}`);
}
fs.renameSync(path.join(output,'electron'),path.join(output,'agent-studio'));
fs.writeFileSync(path.join(output,'Agent Studio.desktop'),`[Desktop Entry]\nType=Application\nName=Agent Studio\nComment=Build with your choice of AI models\nExec=agent-studio\nIcon=agent-studio\nTerminal=false\nCategories=Development;IDE;\n`);
const archive=path.join(root,'dist',`${folder}.tar.gz`);
const result=spawnSync('tar',['-czf',archive,'-C',path.join(root,'dist'),folder],{stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
console.log(`Linux application: ${output}/agent-studio\nPortable archive: ${archive}`);
