// Shared shell for the three mini-program direction boards.
// Plain HTML/CSS strings; no build-time framework. Each direction supplies
// its own CSS and screen bodies, this module only supplies WeChat chrome.

export const W = 375;
export const H = 812;

export const icons = {
  add: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  agenda: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 9.6h17M8 3.2v3.6M16 3.2v3.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7.6 13.3h2.2M12 13.3h2.2M16.4 13.3h.1M7.6 17h2.2M12 17h2.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  me: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.2" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.8 20c1.3-3.7 4-5.6 7.2-5.6s5.9 1.9 7.2 5.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  chevL: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevR: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  caret: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5 12 15l6-5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9.2" y="3.4" width="5.6" height="10.2" rx="2.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.4 11.4a5.6 5.6 0 0 0 11.2 0M12 17v3.4M9.4 20.4h5.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  sync: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.2 12a7.2 7.2 0 0 1-12.3 5.1M4.8 12a7.2 7.2 0 0 1 12.3-5.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M16.4 3.9v3.3h-3.3M7.6 20.1v-3.3h3.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sleep: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 14.6A7.7 7.7 0 0 1 9.4 4.6 7.9 7.9 0 1 0 19.4 14.6Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  off: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.8v7.4M7.2 6.5a7.5 7.5 0 1 0 9.6 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

const statusSvg = (fg) => `<svg width="66" height="12" viewBox="0 0 66 12" fill="${fg}" aria-hidden="true">
<rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="6" width="3" height="6" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/>
<path d="M30 11.2a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4zM25.6 6.4a6.4 6.4 0 018.8 0l-1.1 1.1a4.8 4.8 0 00-6.6 0zM23 3.8a10 10 0 0114 0l-1.1 1.1a8.4 8.4 0 00-11.8 0z"/>
<rect x="41" y="0.75" width="22" height="10.5" rx="3" fill="none" stroke="${fg}" stroke-opacity="0.45" stroke-width="1"/><rect x="43" y="2.75" width="16" height="6.5" rx="1.5"/><rect x="64" y="4" width="1.5" height="4" rx="0.75" fill-opacity="0.45"/></svg>`;

const capsule = (inverted) => {
  const fg = inverted ? '#fff' : '#000';
  const bg = inverted ? 'rgba(20,22,26,0.28)' : 'rgba(255,255,255,0.62)';
  const bd = inverted ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.08)';
  return `<div class="capsule" style="background:${bg};border-color:${bd}">
    <span class="capsule-half"><svg width="20" height="6" viewBox="0 0 20 6"><circle cx="3" cy="3" r="2" fill="${fg}"/><circle cx="10" cy="3" r="2.6" fill="${fg}"/><circle cx="17" cy="3" r="2" fill="${fg}"/></svg></span>
    <span class="capsule-sep" style="background:${bd}"></span>
    <span class="capsule-half"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="${fg}" stroke-width="1.6"/><circle cx="9" cy="9" r="2.6" fill="${fg}"/></svg></span>
  </div>`;
};

const tabbar = (active, tabs) => `<div class="tabbar">
  ${tabs.map((t) => `<div class="tab ${t.label === active ? 'on' : ''}">${t.icon}<span>${t.label}</span></div>`).join('')}
</div>`;

export const tabs = [
  { label: '添加', icon: icons.add },
  { label: '日程', icon: icons.agenda },
  { label: '我的', icon: icons.me },
];

/** One phone. `content` is the page body inside the scroll area. */
export function phone({ page, title = '墨程CalCal', tab = '', nav = 'default', inverted = false, content, screenClass = '' }) {
  return `<div class="device">
  <div class="screen ${screenClass} ${nav === 'custom' ? 'custom-nav' : ''} ${tab ? 'has-tab' : ''}" data-page="${page}">
    <div class="statusbar" style="color:${inverted ? '#F7F3E8' : 'inherit'}"><span>9:41</span>${statusSvg(inverted ? '#F7F3E8' : '#111')}</div>
    ${nav === 'default' ? `<div class="nav"><span class="nav-title">${title}</span></div>` : ''}
    ${capsule(inverted)}
    <div class="scroll">${content}</div>
    ${tab ? tabbar(tab, tabs) : ''}
    <div class="home" style="background:${inverted ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.8)'}"></div>
  </div>
</div>`;
}

/** Absolute board slot; the phone is rendered at 375×812 then scaled. */
export function slot({ x, y, scale = 0.8, label, note, node }) {
  const w = 395 * scale;
  const h = 832 * scale;
  return `<div class="slot" style="left:${x}px;top:${y}px;width:${w}px;">
  <div class="slot-label" style="width:${w}px"><b>${label}</b>${note ? `<span>${note}</span>` : ''}</div>
  <div class="slot-body" style="width:${w}px;height:${h}px"><div class="slot-scale" style="transform:scale(${scale});width:395px;height:832px">${node}</div></div>
</div>`;
}

/** Absolute panel for 1:1 crops and system specimens (not a phone). */
export function panel({ x, y, w, h, label, note, node, cls = '' }) {
  return `<div class="panel ${cls}" style="left:${x}px;top:${y}px;width:${w}px">
  <div class="slot-label" style="width:${w}px"><b>${label}</b>${note ? `<span>${note}</span>` : ''}</div>
  <div class="panel-body" style="width:${w}px;height:${h}px">${node}</div>
</div>`;
}

/** WeChat share card, 5:4 artwork inside. */
export function shareCard({ appName = '墨程CalCal', title, artwork, icon = '' }) {
  return `<div class="share-card">
  <div class="share-head">${icon ? `<span class="share-icon">${icon}</span>` : ''}<span>${appName}</span></div>
  <div class="share-title">${title}</div>
  <div class="share-art" style="width:220px;height:176px">${artwork}</div>
  <div class="share-foot"><svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="none" stroke="#7d7df0" stroke-width="1.4"/><circle cx="6" cy="6" r="1.8" fill="#7d7df0"/></svg>小程序</div>
</div>`;
}

export function chat({ children }) {
  return `<div class="chat">${children}</div>`;
}

export function board({ title, kicker, lede, meta, body, cls = '', style = '' }) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${title} · 墨程CalCal 方向板</title>
<style>__CSS__</style></head>
<body class="${cls}" style="${style}">
<div class="board">
  <header class="board-head">
    <div class="board-kicker">${kicker}</div>
    <h1>${title}</h1>
    <p class="board-lede">${lede}</p>
    ${meta ? `<div class="board-meta">${meta}</div>` : ''}
  </header>
  ${body}
</div>
</body></html>`;
}

export const frameCss = `
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Helvetica Neue",sans-serif;-webkit-font-smoothing:antialiased;}
.board{position:relative;width:1440px;overflow:hidden;}
.board-head{position:absolute;left:56px;top:44px;width:600px;}
.board-kicker{font-size:12px;letter-spacing:.18em;color:var(--muted);}
.board-head h1{margin:10px 0 0;font-size:58px;line-height:1.05;font-weight:300;letter-spacing:.01em;color:var(--fg);}
.board-lede{margin:16px 0 0;font-size:15px;line-height:1.85;color:var(--muted);max-width:540px;}
.board-meta{margin-top:22px;font-size:11px;letter-spacing:.06em;line-height:1.9;color:var(--faint);}
.board-meta b{font-weight:500;color:var(--muted);}

.slot,.panel{position:absolute;}
.slot-label{position:absolute;left:0;top:-54px;font-size:14px;line-height:1.3;}
.slot-label b{display:block;font-weight:600;color:var(--label);letter-spacing:.02em;}
.slot-label span{display:block;margin-top:3px;font-size:12px;line-height:1.5;color:var(--label-dim);}
.slot-body{position:relative;overflow:hidden;}
.slot-scale{transform-origin:0 0;}

.device{width:395px;height:832px;padding:10px;background:#0b0b0c;border-radius:54px;
  box-shadow:0 0 0 1.5px #2a2a2e, 0 28px 60px rgba(15,15,15,.22);}
.screen{position:relative;width:375px;height:812px;border-radius:44px;overflow:hidden;background:var(--paper);
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;color:var(--ink);}
.statusbar{position:absolute;top:0;left:0;right:0;height:44px;display:flex;align-items:center;justify-content:space-between;
  padding:0 26px 0 30px;font-size:15px;font-weight:600;letter-spacing:.01em;z-index:40;pointer-events:none;}
.nav{position:absolute;top:44px;left:0;right:0;height:40px;display:flex;align-items:center;justify-content:center;
  background:var(--nav-bg);z-index:25;}
.nav-title{font-size:17px;font-weight:500;color:var(--nav-fg);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.capsule{position:absolute;top:48px;right:7px;width:87px;height:32px;border-radius:16px;border:.5px solid transparent;
  display:flex;align-items:center;z-index:50;pointer-events:none;}
.capsule-half{flex:1;height:100%;display:flex;align-items:center;justify-content:center;}
.capsule-sep{width:.5px;height:18px;}
.scroll{position:absolute;top:84px;left:0;right:0;bottom:0;overflow:hidden;}
.screen.custom-nav .scroll{top:0;}
.screen.has-tab .scroll{bottom:83px;}
.tabbar{position:absolute;left:0;right:0;bottom:0;height:83px;padding:6px 0 34px;display:flex;
  background:var(--tab-bg);border-top:.5px solid var(--tab-border);z-index:30;}
.tab{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:10px;color:var(--tab-dim);}
.tab.on{color:var(--tab-on);}
.tab svg{width:24px;height:24px;display:block;}
.home{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);width:134px;height:5px;border-radius:999px;z-index:60;}

.share-card{width:236px;background:#fff;border-radius:7px;padding:10px 8px 0;font-family:-apple-system,"PingFang SC",sans-serif;
  box-shadow:0 2px 10px rgba(0,0,0,.12);}
.share-head{display:flex;align-items:center;gap:6px;font-size:12px;color:#8a8a86;margin-bottom:6px;}
.share-icon{width:16px;height:16px;border-radius:999px;overflow:hidden;display:inline-block;background:#eee;}
.share-icon img{width:100%;height:100%;object-fit:cover;display:block;}
.share-title{font-size:14px;line-height:1.4;color:#151515;margin-bottom:8px;}
.share-art{overflow:hidden;background:#f2f2f2;position:relative;}
.share-foot{display:flex;align-items:center;gap:4px;font-size:11px;color:#9a9a96;border-top:.5px solid #eee;
  margin-top:8px;padding:6px 0;}
.chat{background:#ececeb;padding:10px;border-radius:6px;display:inline-block;}
.chat-line{display:flex;align-items:flex-start;gap:8px;}
.chat-avatar{width:30px;height:30px;border-radius:5px;background:#c8c4ba;color:#5f5b52;font-size:13px;display:flex;
  align-items:center;justify-content:center;flex:none;}
.panel-body{position:relative;overflow:hidden;color:var(--ink,#1F2328);}
`;
