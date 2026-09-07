const assert=require('node:assert/strict');
module.exports=async ({win,js,click})=>{
  const original=win.getContentSize();
  const measure=()=>js(`(()=>{const box=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,hidden:e.hidden}};return {width:innerWidth,height:innerHeight,body:document.body.scrollWidth,settings:box('.sidebar-footer [data-view=settings]'),composer:box('#composer'),prompt:box('#prompt'),send:box('#send')}})()`);
  for(const [width,height,zoom] of [[1440,900,1],[1020,700,1],[1440,900,1.25]]){
    win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);
    await new Promise(r=>setTimeout(r,120));
    for(const theme of ['light','dark']){
      await js(`state.settings={...state.settings,theme:${JSON.stringify(theme)}};render()`);
      for(const mode of ['#chat-mode','#computer-mode','#workspace-mode']){
        await click(mode);const m=await measure();
        const label=`${width}x${height} zoom ${zoom} ${theme} ${mode}`;
        assert.ok(m.body<=m.width+1,label+' has horizontal page overflow');
        assert.ok(m.settings.top>=0 && m.settings.bottom<=m.height+1,label+' hides Settings');
        assert.ok(m.composer.top>=0 && m.composer.bottom<=m.height+1,label+' pushes the composer offscreen');
        assert.ok(m.prompt.height>=40 && m.send.width>=28,label+' has unusable composer controls');
      }
      await click('[data-view=providers]');await click('#new-model');
      const modal=await js(`(()=>{const d=document.querySelector('#modal'),r=d.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,scroll:d.scrollHeight,client:d.clientHeight,overflow:getComputedStyle(d).overflowY}})()`);
      assert.ok(modal.top>=0&&modal.bottom<=modal.height+1,'Connection dialog exceeds the window');
      if(modal.scroll>modal.client+1)assert.ok(['auto','scroll'].includes(modal.overflow),'Connection dialog cannot scroll');
      await click('[data-close]');
    }
  }
  win.webContents.setZoomFactor(1);win.setContentSize(...original);
  console.log('Design layout verified: Chat, Computer, Workspace and connection dialogs in both themes, smaller windows, and 125% scaling.');
};
