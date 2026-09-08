import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=process.argv[2];
const port=Number(process.argv[3]||5198);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'};
const proxyHeaders=req=>({...req.headers,host:'localhost:8520',...(req.headers.origin?{origin:'http://localhost:3000'}:{})});
const server=http.createServer((req,res)=>{
 if(req.url.startsWith('/api/')){
  const upstream=http.request({hostname:'127.0.0.1',port:8520,path:req.url,method:req.method,headers:proxyHeaders(req)},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});
  upstream.on('error',()=>{res.writeHead(502);res.end()});req.pipe(upstream);return;
 }
 let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!file.startsWith(path.resolve(root)+path.sep)){file=path.join(root,'index.html')}
 if(!fs.existsSync(file)||!fs.statSync(file).isFile())file=path.join(root,'index.html');
 res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':file.includes('/assets/')?'public,max-age=3600':'no-cache'});fs.createReadStream(file).pipe(res);
});
server.on('upgrade',(req,socket,head)=>{
 const upstream=http.request({hostname:'127.0.0.1',port:8520,path:req.url,headers:proxyHeaders(req)});
 upstream.on('upgrade',(res,remote,remoteHead)=>{
  socket.write(`HTTP/1.1 ${res.statusCode} Switching Protocols\r\n`+Object.entries(res.headers).map(([k,v])=>`${k}: ${v}\r\n`).join('')+'\r\n');
  if(remoteHead.length)socket.write(remoteHead);if(head.length)remote.write(head);
  remote.pipe(socket);socket.pipe(remote);socket.on('error',()=>remote.destroy());remote.on('error',()=>socket.destroy());
 });upstream.on('error',()=>socket.destroy());upstream.end();
});
server.listen(port,'127.0.0.1',()=>console.log(`Performance frontend listening on ${port}`));
