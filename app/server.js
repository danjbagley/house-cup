// House Cup state server — static app + one JSON blob at /api/state.
// Single-writer by design: run exactly ONE replica.
const http=require('http'),fs=require('fs'),path=require('path');
const DATA=process.env.DATA_DIR||'/data';
const FILE=path.join(DATA,'state.json');
const PUB=path.join(__dirname,'public');
const MAX=5*1024*1024; // matches artifact storage's 5MB ceiling
fs.mkdirSync(DATA,{recursive:true});
const MIME={'.html':'text/html; charset=utf-8','.png':'image/png','.ico':'image/x-icon'};
http.createServer((req,res)=>{
  const u=req.url.split('?')[0];
  if(u==='/healthz'){res.writeHead(200);return res.end('ok')}
  if(u==='/api/state'){
    if(req.method==='GET'){
      return fs.readFile(FILE,(e,b)=>{
        if(e){res.writeHead(204,{'Cache-Control':'no-store'});return res.end()}
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(b)})}
    if(req.method==='PUT'){
      let chunks=[],n=0,dead=false;
      req.on('data',c=>{n+=c.length;
        if(n>MAX){dead=true;res.writeHead(413);res.end();req.destroy();return}
        chunks.push(c)});
      req.on('end',()=>{if(dead)return;
        const body=Buffer.concat(chunks).toString();
        try{JSON.parse(body)}catch(e){res.writeHead(400);return res.end('not json')}
        const tmp=FILE+'.tmp';                       // atomic write: tmp then rename
        fs.writeFile(tmp,body,e=>{
          if(e){res.writeHead(500);return res.end()}
          fs.rename(tmp,FILE,e2=>{res.writeHead(e2?500:204);res.end()})})});
      return}
    res.writeHead(405);return res.end()}
  // static files, traversal-safe
  let p=u==='/'?'/index.html':u;
  const f=path.join(PUB,path.normalize(p));
  if(!f.startsWith(PUB)){res.writeHead(403);return res.end()}
  fs.readFile(f,(e,b)=>{
    if(e){res.writeHead(404);return res.end('not found')}
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(b)})
}).listen(process.env.PORT||8080,()=>console.log('House Cup listening on',process.env.PORT||8080));
