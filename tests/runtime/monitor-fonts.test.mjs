import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL('.cache/ms-playwright', root));
const { chromium, expect } = await import('@playwright/test');

test('classic per-block fonts survive opaque iframe snapshots, zoom and no-JS without resizing panels', { timeout: 300000 }, async () => {
  const fixtures = JSON.parse(execFileSync(process.execPath, ['--conditions=react-server', '--input-type=module', '-e', `
    import { monitorFontScaleOptions } from './lib/config/presentation.ts';
    import { monitorFixture } from './tests/fixtures/monitor-compat.mjs';
    import { renderCompatiblePage, renderCompatibleContent, compatibleMonitorState } from './lib/server/monitor-compat/render.ts';
    const model = monitorFixture({ summaryEnabled:false, fontScalePercent:150 });
    model.document.publicMonitorAutoScrollOnLoad = false;
    model.refreshAfterMs = 60000;
    const find = type => model.screen.blocks.find(block => block.type === type);
    const cards = model.overview.data.blocks.find(block => block.type === 'highlighted_resources').data.cards;
    cards.find(card => card.kind === 'resource').item.config.presentation.cardMetrics = ['cpu','memory','disk'];
    cards.find(card => card.kind === 'signal_service').item.cardMetrics = ['cpu','memory','disk'];
    find('highlighted_resources').options.rowMode='manual'; find('highlighted_resources').options.visibleRows=2;
    model.screen.overviewGrid='split_custom';
    model.screen.overviewSlots={topLeft:[find('highlighted_resources').id],topRight:[find('signal_flow').id,find('storage_summary').id],bottomLeft:[find('asgard_summary').id],bottomRight:[]};
    const variants=[];
    for(const summaryEnabled of [false,true]) for(const size of ['compact','expanded']) for(const zoom of [70,100,125]) for(const scale of monitorFontScaleOptions) {
      find('summary').enabled=summaryEnabled;
      find('highlighted_resources').options.cardSize=size;
      model.document.publicMonitorZoomPercent=zoom;
      for(const block of model.screen.blocks) block.monitorFontScalePercent=scale;
      model.document.revision++;
      const fullPage = variants.length === 0 || (summaryEnabled && size === 'expanded' && zoom === 125 && scale === 160);
      variants.push({size,zoom,scale,page:fullPage ? renderCompatiblePage(model,'Font fixture') : null,html:renderCompatibleContent(model),state:compatibleMonitorState(model)});
    }
    process.stdout.write(JSON.stringify(variants));
  `], { cwd: fileURLToPath(root), windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  let current = fixtures[0];
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://test').pathname;
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<style>body{margin:0}iframe{border:0;width:1920px;height:1080px}</style><iframe title="Monitor" sandbox="allow-scripts" src="/monitor/compat"></iframe>'); }
    else if (path.startsWith('/monitor/compat/notifications')) { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({events:[],incidents:[],counts:{unreadCount:0,activeCount:0},runtime:{enabled:false},syncCursor:'0'})); }
    else if (path === '/monitor/compat') { const fragment=req.url.includes('fragment=1'); res.setHeader('Content-Type',fragment?'application/json':'text/html'); res.end(fragment ? JSON.stringify({html:current.html,state:current.state}) : current.page); }
    else if (/^\/monitor-(?:compat(?:-audio|-notifications)?|auto-scroll)\.(?:js|css)$/.test(path)) {
      try { res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'application/javascript'); res.end(await readFile(new URL('.next/standalone/public'+path, root))); } catch { res.writeHead(404); res.end(); }
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port, browser=await chromium.launch();
  try {
    const page=await browser.newPage({ viewport:{width:1920,height:1080} });
    await page.clock.setFixedTime(new Date());
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base); const frame=page.frameLocator('iframe');
    const measure=()=>frame.locator('[data-block-id]').evaluateAll(blocks=>blocks.map(block=>({
      id:block.getAttribute('data-block-id'), width:block.getBoundingClientRect().width,height:block.getBoundingClientRect().height,
      fonts:[...block.querySelectorAll('*')].filter(node=>node.getBoundingClientRect().width>0&&[...node.childNodes].some(child=>child.nodeType===3&&child.textContent.trim())).map(node=>({text:node.textContent.trim(),size:parseFloat(getComputedStyle(node).fontSize)})),
    })));
    let baseline;
    for (const variant of fixtures) {
      current=variant;
      await frame.locator('#compat-refresh').click();
      await expect(frame.locator('[data-monitor-font-scale]').first()).toHaveAttribute('data-monitor-font-scale',String(current.scale));
      await expect.poll(()=>frame.locator('html').evaluate(node=>node.style.zoom)).toBe(String(current.zoom)+'%');
      const measured=await measure();
      if(current.scale===100) baseline=measured;
      else for(let i=0;i<measured.length;i++) {
        assert.ok(Math.abs(measured[i].height-baseline[i].height)<1.5,`height ${current.size}/${current.zoom}/${current.scale}/${i}: ${measured[i].height} vs ${baseline[i].height}`);
        assert.ok(Math.abs(measured[i].width-baseline[i].width)<1);
        measured[i].fonts.forEach((font,j)=>assert.ok(Math.abs(font.size-baseline[i].fonts[j].size*current.scale/100)<.04, JSON.stringify({text:font.text,scale:current.scale,actual:font.size,before:baseline[i].fonts[j].size})));
      }
      const cards=await frame.locator('.availability-card').evaluateAll(cards=>cards.map(card=>{
        const rect=card.getBoundingClientRect(),footer=card.querySelector('.availability-footer').getBoundingClientRect();
        return {height:rect.height,overflow:footer.bottom-rect.bottom,content:card.scrollHeight-card.clientHeight, meters:[...card.querySelectorAll('.metric-meter')].map(meter=>meter.getBoundingClientRect().height)};
      }));
      for(const card of cards) {
        assert.ok(Math.abs(card.height-(current.size==='compact'?148:168)*current.zoom/100)<1);
        for (const height of card.meters) assert.ok(Math.abs(height-(current.size==='compact'?12:16)*current.zoom/100)<1);
        assert.ok(card.overflow<=1,JSON.stringify({variant:[current.size,current.zoom,current.scale],card}));
      }
      const panelMeters=await frame.locator('[data-block-id]:not(.block-highlighted_resources) .metric-meter').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
      assert.ok(panelMeters.length>0);
      for(const height of panelMeters) assert.ok(Math.abs(height-12*current.zoom/100)<1);
      const spacing=await frame.locator('.mini-metrics[data-metric-count="3"]').evaluateAll(groups=>groups.map(group=>{
        const [disk,cpu]=group.children, value=disk.querySelector('strong'), label=disk.querySelector('span');
        return {diskGap:cpu.getBoundingClientRect().top-disk.querySelector('.metric-meter').getBoundingClientRect().bottom,
          percentSize:parseFloat(getComputedStyle(value).fontSize),labelSize:parseFloat(getComputedStyle(label).fontSize)};
      }));
      assert.ok(spacing.length>0);
      for(const reading of spacing){
        assert.ok(Math.abs(reading.diskGap-6*current.zoom/100)<1,JSON.stringify({current:[current.size,current.zoom,current.scale],reading}));
        assert.ok(Math.abs(reading.percentSize-(current.size==='compact'?13:14.3)*current.scale/100)<.01);
        assert.ok(Math.abs(reading.labelSize-(current.size==='compact'?9:11)*current.scale/100)<.01);
      }
      assert.ok(await frame.locator('.availability-panel').evaluate(node=>node.scrollHeight-node.clientHeight)<=1);
      if (current.size === 'expanded' && current.zoom === 70 && current.scale === 160) await page.screenshot({ path: '.cache/font-classic-160-' + current.size + '.png' });
    }
    await frame.locator('#compat-auto-scroll').click();
    await expect.poll(()=>frame.locator('.block-asgard_summary .panel-content').evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
    assert.deepEqual(errors,[]);
    const noJs=await browser.newContext({javaScriptEnabled:false,viewport:{width:1920,height:1080}});
    const plain=await noJs.newPage(); await plain.goto(base+'/monitor/compat');
    assert.ok(Math.abs(await plain.locator('.panel-heading h2').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize))-20.8)<.01);
    await noJs.close();
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
});
