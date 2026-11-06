// Regression layout: three expanded service rows, Signal/Problems stacked above
// Storage, and independent fonts. Storage must not enlarge the bottom row.
export function storageViewportFixture(model) {
  const screen = model.document.screens[0], find = type => screen.blocks.find(block => block.type === type);
  if (!find('problems')) {
    const id = '00000000-0000-4000-8000-000000009601';
    screen.blocks.push({ id, type: 'problems', enabled: true, width: 'standard', options: { visibleRows: 6, sortBy: 'severity', sortDirection: 'desc', severities: [0, 1, 2, 3, 4, 5] } });
    model.overview.data.blocks.push({ blockId: id, type: 'problems', data: model.overview.data.problems, availability: 'ready', stale: false, lastUpdated: model.overview.lastUpdated });
  }
  find('summary').enabled = false;
  find('highlighted_resources').options = { ...find('highlighted_resources').options, cardSize: 'expanded', rowMode: 'manual', visibleRows: 3 };
  for (const block of screen.blocks) block.monitorFontScalePercent = ({ highlighted_resources: 130, asgard_summary: 160, problems: 145 })[block.type] ?? 100;
  screen.overviewGrid = 'split_custom';
  screen.overviewSlots = { topLeft: [find('highlighted_resources').id], topRight: [find('signal_flow').id, find('problems').id], bottomLeft: [find('asgard_summary').id], bottomRight: [find('storage_summary').id] };
  const cards = model.overview.data.blocks.find(block => block.type === 'highlighted_resources').data.cards;
  const service = cards.find(card => card.kind === 'signal_service');
  for (let i = cards.length; i < 8; i++) cards.push({ ...service, item: { ...service.item, id: `00000000-0000-4000-8000-00000000960${i}`, displayName: `Serviço ${i + 1}` } });
  model.document.defaultTvMode = true;
  model.document.showStatusBanner = false;
  model.document.publicMonitorAutoScrollOnLoad = false;
  model.document.rotation.autoStart = false;
  model.document.publicMonitorZoomPercent = 80;
  const second = structuredClone(screen);
  second.id = '00000000-0000-4000-8000-000000009700'; second.name = 'Tela 2';
  const ids = new Map(second.blocks.map((block, index) => [block.id, `00000000-0000-4000-8000-${String(9701 + index).padStart(12, '0')}`]));
  for (const block of second.blocks) block.id = ids.get(block.id);
  for (const key of Object.keys(second.overviewSlots)) second.overviewSlots[key] = second.overviewSlots[key].map(id => ids.get(id));
  model.document.screens = [screen, second];
  if (model.screens) model.screens = model.document.screens;
}
