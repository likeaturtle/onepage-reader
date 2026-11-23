import { phone, slot, panel, shareCard, chat, board, frameCss } from './frame.mjs';

const events = [
  { t: '09:00', title: '周会', note: '5 楼小会议室' },
  { t: '14:00', title: '设计评审', note: '带上打印稿' },
  { t: '19:30', title: '英语听力', note: '第 4 单元' },
];

const todayBlock = () => `<div class="l-today">
  <div class="l-today-head"><span>今天</span><em>11月23日 周一</em><b>3 条</b></div>
  ${events.map((e) => `<div class="l-today-row"><span>${e.t}</span><b>${e.title}</b><em>${e.note}</em></div>`).join('')}
</div>`;

const login = (logo) => phone({
  page: 'pages/login/login', nav: 'custom', screenClass: 'l-screen',
  content: `<div class="l-login">
    <div class="l-login-brand"><img class="l-mark" src="${logo}" alt=""><div class="l-brand">墨程CalCal</div><div class="l-tag">把日程写进墨水屏</div></div>
    <div class="l-login-card">
      <div class="l-card-title">登录后开始连接设备</div>
      <p class="l-card-copy">用微信身份识别你的账号，日程会同时保存在云端，没带设备也能看。</p>
      <div class="l-cta">微信一键登录</div>
      <p class="l-note">首次在真机上使用时，请允许微信访问蓝牙。登录状态保存在本机，可在「我的」中退出。</p>
    </div>
    <div class="l-api">接口 calcal.acenova.tech</div>
  </div>`,
});

const add = () => phone({
  page: 'pages/index/index', title: '墨程CalCal', tab: '添加', screenClass: 'l-screen',
  content: `<div class="l-add">
    ${todayBlock()}
    <div class="l-device"><span class="dot"></span><b>墨程CalCal</b><span>已连接</span><i>同步</i><i>休眠</i><i class="del">断开</i></div>
    <div class="l-editor">
      <div class="l-editor-head"><span>新日程</span><em>11月24日 周二</em></div>
      <div class="l-pills"><span class="on">11月24日 周二</span><span>15:00 — 16:00</span></div>
      <div class="l-voice-text">明天下午三点项目评审，会议室 A，带上打印稿</div>
      <div class="l-field"><span>标题</span><b>项目评审</b><i>12/95</i></div>
      <div class="l-field"><span>备注</span><b>会议室 A · 带上打印稿</b><i>30/191</i></div>
      <div class="l-voice"><span class="l-mic"><i></i></span><b>按住 说话</b><em>解析日程</em></div>
      <div class="l-save">保存日程</div>
    </div>
    <div class="l-log">查看蓝牙协议日志</div>
  </div>`,
});

const agenda = () => phone({
  page: 'pages/calendar/calendar', title: '墨程CalCal', tab: '日程', screenClass: 'l-screen',
  content: `<div class="l-ag">
    <div class="l-ag-head"><div><div class="l-kicker">2026</div><div class="l-month">十一月</div></div><div class="l-ag-meta">6 条 · 已同步</div><div class="l-nav"><span>&lsaquo;</span><span>&rsaquo;</span></div></div>
    ${todayBlock()}
    <div class="l-sec-title">接下来</div>
    <div class="l-group">
      <div class="l-group-head"><b>24</b><span>周二</span><em>2 条</em></div>
      <div class="l-row"><span class="l-row-time">10:00</span><div class="l-row-main"><b>客户电话</b><em></em></div><div class="l-acts"><i>编辑</i><i class="del">删除</i></div></div>
      <div class="l-row"><span class="l-row-time">15:00</span><div class="l-row-main"><b>项目评审</b><em>会议室 A</em></div><div class="l-acts"><i>编辑</i><i class="del">删除</i></div></div>
    </div>
    <div class="l-group">
      <div class="l-group-head"><b>26</b><span>周四</span><em>1 条</em></div>
      <div class="l-row"><span class="l-row-time">18:00</span><div class="l-row-main"><b>牙医复诊</b><em>口腔医院 3 楼</em></div><div class="l-acts"><i>编辑</i><i class="del">删除</i></div></div>
    </div>
    <div class="l-ag-foot">本月共 6 条 · 云端已同步</div>
  </div>`,
});

const profile = () => phone({
  page: 'pages/profile/profile', title: '墨程CalCal', tab: '我的', screenClass: 'l-screen',
  content: `<div class="l-me">
    <div class="l-me-head"><span class="l-avatar">林</span><div><div class="l-name">林屿</div><div class="l-uid">用户 ID u_7f3a9c21</div></div><span class="l-save-link">保存</span></div>
    <div class="l-sheet">
      <div class="l-sheet-row"><span>我的设备</span><b>墨程CalCal</b><i class="l-unbind">解绑</i></div>
      <div class="l-sheet-row"><span>绑定日期</span><b>2026-11-09</b></div>
      <div class="l-sheet-row"><span>固件</span><b>1.0.0</b></div>
    </div>
    <div class="l-sheet">
      <div class="l-sheet-row"><span>应用</span><b>墨程CalCal</b></div>
      <div class="l-sheet-row"><span>登录方式</span><b>微信登录</b></div>
      <div class="l-sheet-row"><span>接口地址</span><b class="mono">calcal.acenova.tech</b></div>
      <div class="l-sheet-row"><span>客户端版本</span><b>体验版</b></div>
      <div class="l-sheet-row"><span>设备协议</span><b>proto 3</b></div>
    </div>
    <p class="l-explain">日程保存在云端，连接设备后自动双向同步，设备端删除也会同步删除云端对应日程。解绑只解除云端归属，不清除设备密钥。</p>
    <div class="l-logout">退出登录</div>
  </div>`,
});

/* panels */
const todayCrop = () => `<div class="l-today-crop">${todayBlock()}<div class="l-crop-note">今天是一块淡黄底：先把今天说清楚，再往下写。</div></div>`;

const pairingCrop = () => `<div class="l-pair">
  <div class="l-pair-ghost"><div class="l-ghost-bar"></div><div class="l-ghost-bar short"></div></div>
  <div class="l-modal">
    <div class="l-modal-title">设备配对</div>
    <div class="l-modal-sub">输入设备屏幕上的 12 位配对码</div>
    <div class="l-modal-input">K7Q4 M2X9 B3TF</div>
    <div class="l-modal-hint">不区分大小写，例如 K7Q4M2X9B3TF</div>
    <div class="l-modal-actions"><span>取消</span><span class="ok">配对</span></div>
  </div>
</div>`;

const spec = () => `<div class="l-spec">
  <div class="l-spec-title">清单的样子</div>
  <div class="l-spec-demo">
    <div class="l-demo-head"><b>24</b><span>周二</span><em>2 条</em></div>
    <div class="l-demo-row"><span></span><b>客户电话</b><em>10:00</em></div>
    <div class="l-demo-row"><span></span><b>项目评审</b><em>15:00</em></div>
  </div>
  <div class="l-spec-notes">
    <div><b>缩进的发丝线</b><span>从时间列右侧起，44 px</span></div>
    <div><b>淡黄只给今天</b><span>#FBF1D6 / 边线 #F0E0B4</span></div>
    <div><b>一个浮起的编辑卡</b><span>0 24 50 / 10% 阴影</span></div>
  </div>
  <div class="l-spec-colors"><span style="background:#FFFFFF"></span><span style="background:#F2F1ED"></span><span style="background:#1D1D1F"></span><span style="background:#FBF1D6"></span></div>
  <div class="l-spec-caps">白 / 灰 / 墨 / 今天 · 正文 13–14，标签 12</div>
</div>`;

const shareArt = (logo) => `<div class="l-share-art">
  <img src="${logo}" alt="">
  <div class="l-share-today"><span>今天</span><b>3 条</b></div>
  <div class="l-share-title">把今天<br>写下来</div>
  <div class="l-share-meta">墨程CalCal · 11月23日</div>
</div>`;

export function dirE(logo) {
  const body = `
  ${slot({ x: 56, y: 350, scale: 0.76, label: '登录', note: '一张浮起的登录卡', node: login(logo) })}
  ${slot({ x: 380, y: 320, scale: 0.86, label: '添加', note: '今天在上，编辑卡在下', node: add() })}
  ${slot({ x: 736, y: 350, scale: 0.8, label: '日程', note: '今天摘要 + 缩进清单', node: agenda() })}
  ${slot({ x: 1064, y: 380, scale: 0.76, label: '我的', note: '设置分组 · 没有卡片墙', node: profile() })}
  ${panel({ x: 56, y: 1090, w: 375, h: 380, label: '今天 · 1:1', note: '淡黄底只给今天', node: todayCrop() })}
  ${panel({ x: 463, y: 1090, w: 375, h: 380, label: '配对 · 1:1', note: 'iOS 式浮起卡片', node: pairingCrop() })}
  ${panel({ x: 870, y: 1090, w: 300, h: 380, label: '清单的语法', note: '缩进 44 / 阴影 / 黄', node: spec() })}
  <div class="l-share" style="left:1180px;top:1066px">
    <div class="l-share-label-board">转发卡片 · 5:4</div>
    ${chat({ children: shareCard({ title: '把今天写下来', artwork: shareArt(logo), icon: `<img src="${logo}" alt="">` }) })}
  </div>`;

  const html = board({
    title: '纸上清单',
    kicker: '备选 B2 · 现实参照｜Things 3',
    lede: '把日程当成一张会呼吸的清单：今天先给一块淡黄底，接下来的日子用缩进的发丝线排下去，写一条时浮起一张纸。',
    meta: '<b>form 来自</b> 清单与便签 · <b>主入口</b> 扫码后先看今天 · <b>借的</b> 今日摘要块 + 缩进发丝线 + 一张浮起的编辑卡',
    body,
    cls: 'l-board',
  });
  return html.replace('__CSS__', frameCss + css);
}

const css = `
.l-board .board{height:1520px;}
.l-board{--paper:#F2F1ED;--ink:#1D1D1F;--muted:#8A8F9B;--line:#E6E5E0;--amber:#E8A400;
  --nav-bg:#F2F1ED;--nav-fg:#1D1D1F;--tab-bg:#FFFFFF;--tab-on:#1D1D1F;--tab-dim:#B7B9B6;--tab-border:#ECEBE6;
  --fg:#1D1D1F;--label:#3A3B3D;--label-dim:#8A8F9B;
  background:#F4F3EF;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;}
.l-board::before{content:"";position:absolute;left:0;right:0;top:0;height:248px;background:#FBF1D6;}
.l-board .board-head{top:40px;}
.l-board .board-kicker{color:#A77A1B;}
.l-board .board-head h1{font-size:54px;font-weight:700;letter-spacing:-.01em;color:#1D1D1F;margin-top:8px;}
.l-board .board-lede{color:#6F6A5C;font-size:15px;max-width:620px;}
.l-board .board-meta{color:#8F8878;}
.l-board .board-meta b{color:#6F6A5C;}
.l-board .slot,.l-board .panel,.l-board .l-share{position:absolute;z-index:2;}

.l-screen{--paper:#F2F1ED;}
.l-mark{display:block;width:62px;height:62px;margin:0 auto;}
.l-login{height:100%;padding:104px 26px 24px;display:flex;flex-direction:column;align-items:center;}
.l-login-brand{text-align:center;}
.l-brand{margin-top:16px;font-size:28px;font-weight:700;letter-spacing:.01em;color:#1D1D1F;}
.l-tag{margin-top:6px;font-size:11.5px;color:#8A8F9B;letter-spacing:.12em;}
.l-login-card{margin-top:48px;width:100%;background:#FFFFFF;border-radius:18px;padding:22px 20px 18px;box-shadow:0 2px 6px rgba(0,0,0,.04),0 26px 60px rgba(0,0,0,.08);}
.l-card-title{font-size:18px;font-weight:600;color:#1D1D1F;}
.l-card-copy{margin:8px 0 18px;font-size:13px;line-height:1.8;color:#6E7278;}
.l-cta{height:48px;border-radius:12px;background:#1D1D1F;color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-size:14px;letter-spacing:.04em;}
.l-note{margin:12px 0 0;font-size:11.5px;line-height:1.75;color:#9A9EA3;}
.l-api{margin-top:auto;font-size:10px;color:#A9ACB0;text-align:center;}

.l-add{padding:16px 18px 18px;}
.l-today{background:#FBF1D6;border:1px solid #F0E0B4;border-radius:14px;padding:12px 14px 10px;}
.l-today-head{display:flex;align-items:baseline;gap:8px;}
.l-today-head span{font-size:13px;font-weight:700;color:#1D1D1F;}
.l-today-head em{font-style:normal;font-size:11px;color:#8B7A4C;}
.l-today-head b{margin-left:auto;font-size:11px;font-weight:600;color:#A77A1B;}
.l-today-row{display:flex;align-items:baseline;gap:8px;padding:5px 0;border-top:1px solid rgba(167,122,27,.14);}
.l-today-row:first-of-type{border-top:none;}
.l-today-row span{width:38px;flex:none;font-size:10.5px;color:#8B7A4C;font-feature-settings:"tnum";}
.l-today-row b{font-size:12.5px;font-weight:500;color:#1D1D1F;}
.l-today-row em{margin-left:auto;font-style:normal;font-size:10px;color:#9A8A60;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.l-device{display:flex;align-items:center;gap:7px;height:34px;padding:0 4px;font-size:10.5px;color:#8A8F9B;}
.l-device .dot{width:5px;height:5px;border-radius:50%;background:#34A16F;}
.l-device b{font-size:11.5px;font-weight:600;color:#1D1D1F;}
.l-device i{margin-left:auto;font-style:normal;font-size:11px;color:#6E7278;}
.l-device i + i{margin-left:9px;}
.l-device i.del{color:#C4553B;}
.l-editor{background:#FFFFFF;border-radius:18px;padding:16px 16px 14px;box-shadow:0 2px 6px rgba(0,0,0,.04),0 26px 60px rgba(0,0,0,.10);}
.l-editor-head{display:flex;align-items:baseline;justify-content:space-between;}
.l-editor-head span{font-size:16px;font-weight:600;}
.l-editor-head em{font-style:normal;font-size:11px;color:#8A8F9B;}
.l-pills{display:flex;gap:7px;margin-top:12px;}
.l-pills span{flex:1;height:36px;border-radius:10px;background:#F2F1ED;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:#4E5157;font-feature-settings:"tnum";}
.l-pills span.on{background:#FBF1D6;color:#8B6A1D;font-weight:500;}
.l-voice-text{margin-top:9px;background:#F7F6F1;border-radius:8px;padding:8px 10px;font-size:11.5px;line-height:1.7;color:#4E5157;}
.l-field{display:flex;align-items:baseline;gap:8px;height:38px;border-bottom:1px solid #ECEBE6;}
.l-field span{width:32px;flex:none;font-size:11px;color:#9A9EA3;}
.l-field b{font-size:13px;font-weight:500;color:#1D1D1F;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.l-field i{margin-left:auto;font-style:normal;font-size:9px;color:#B7B9B6;}
.l-voice{display:flex;align-items:center;gap:10px;margin-top:12px;height:40px;}
.l-mic{width:40px;height:40px;border-radius:20px;background:#1D1D1F;display:flex;align-items:center;justify-content:center;flex:none;}
.l-mic i{width:2px;height:13px;border-radius:1px;background:#FFFFFF;display:block;}
.l-voice b{font-size:12px;font-weight:500;color:#1D1D1F;}
.l-voice em{margin-left:auto;font-style:normal;font-size:11.5px;color:#8A8F9B;}
.l-save{margin-top:12px;height:48px;border-radius:12px;background:#1D1D1F;color:#FFFFFF;display:flex;align-items:center;justify-content:center;font-size:14px;letter-spacing:.04em;}

.l-ag{padding:16px 18px 18px;}
.l-ag-head{display:flex;align-items:flex-end;gap:8px;}
.l-kicker{font-size:10.5px;color:#9A9EA3;letter-spacing:.14em;}
.l-month{font-size:27px;font-weight:700;letter-spacing:-.01em;color:#1D1D1F;margin-top:2px;}
.l-ag-meta{font-size:10.5px;color:#8A8F9B;padding-bottom:5px;}
.l-nav{margin-left:auto;display:flex;gap:6px;}
.l-nav span{width:30px;height:30px;border-radius:15px;background:#FFFFFF;border:1px solid #E6E5E0;display:flex;align-items:center;justify-content:center;font-size:15px;color:#4E5157;}
.l-ag .l-today{margin-top:12px;}
.l-sec-title{margin-top:16px;font-size:11px;letter-spacing:.1em;color:#8A8F9B;}
.l-group{margin-top:4px;}
.l-group-head{display:flex;align-items:baseline;gap:6px;padding:10px 0 5px;}
.l-group-head b{font-size:20px;font-weight:700;color:#1D1D1F;line-height:1;font-feature-settings:"tnum";}
.l-group-head span{font-size:11px;color:#8A8F9B;}
.l-group-head em{margin-left:auto;font-style:normal;font-size:10.5px;color:#B0B3B0;}
.l-row{display:flex;align-items:flex-start;gap:8px;padding:10px 0;border-top:1px solid #ECEBE6;}
.l-row-time{width:40px;flex:none;font-size:11px;color:#8A8F9B;padding-top:2px;font-feature-settings:"tnum";}
.l-row-main{flex:1;min-width:0;}
.l-row-main b{display:block;font-size:13.5px;font-weight:500;color:#1D1D1F;line-height:1.35;}
.l-row-main em{display:block;margin-top:2px;font-style:normal;font-size:11px;color:#9A9EA3;}
.l-acts{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:3px;}
.l-acts i{font-style:normal;font-size:11px;color:#A9ACB0;}
.l-acts i.del{color:#C4553B;}
.l-ag-foot{margin-top:16px;text-align:center;font-size:10px;color:#B0B3B0;}

.l-me{padding:18px 18px 22px;display:flex;flex-direction:column;min-height:100%;}
.l-me-head{display:flex;align-items:center;gap:12px;padding:2px 2px 16px;}
.l-avatar{width:54px;height:54px;border-radius:27px;background:#FBF1D6;color:#8B6A1D;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:600;flex:none;}
.l-name{font-size:20px;font-weight:700;}
.l-uid{margin-top:3px;font-size:10px;color:#9A9EA3;}
.l-save-link{margin-left:auto;font-size:11px;color:#8A6A1D;}
.l-sheet{background:#FFFFFF;border-radius:14px;padding:0 14px;margin-bottom:12px;}
.l-sheet-row{display:flex;align-items:center;gap:10px;height:44px;border-top:1px solid #F0EFEA;font-size:12.5px;}
.l-sheet-row:first-child{border-top:none;}
.l-sheet-row span{color:#8A8F9B;flex:none;}
.l-sheet-row b{margin-left:auto;font-weight:500;color:#1D1D1F;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;}
.l-sheet-row .mono{font-family:Menlo,monospace;font-size:10px;font-weight:400;}
.l-unbind{font-style:normal;color:#C4553B;font-size:11px;margin-left:2px;}
.l-explain{margin:0 2px;font-size:11px;line-height:1.8;color:#9A9EA3;}
.l-log{margin-top:10px;text-align:center;font-size:10.5px;color:#A9ACB0;}
.l-logout{margin-top:auto;padding-top:16px;text-align:center;font-size:12px;color:#C4553B;letter-spacing:.06em;}

.panel-body{background:#F2F1ED;}
.l-today-crop{padding:18px;height:380px;}
.l-today-crop .l-today{padding:16px 16px 12px;}
.l-today-crop .l-today-row{padding:8px 0;}
.l-today-crop .l-today-row span{font-size:12px;}
.l-today-crop .l-today-row b{font-size:14px;}
.l-crop-note{margin-top:14px;font-size:10.5px;line-height:1.8;color:#8A8F9B;}
.l-pair{position:relative;height:380px;background:#F2F1ED;overflow:hidden;}
.l-pair-ghost{position:absolute;left:28px;right:28px;top:40px;opacity:.4;}
.l-ghost-bar{height:14px;border-radius:7px;background:#E4E2DA;margin-bottom:12px;}
.l-ghost-bar.short{width:62%;}
.l-modal{position:absolute;left:36px;right:36px;top:88px;background:#FFFFFF;border-radius:18px;padding:20px 18px 16px;box-shadow:0 2px 6px rgba(0,0,0,.05),0 26px 60px rgba(0,0,0,.14);}
.l-modal-title{font-size:19px;font-weight:700;}
.l-modal-sub{margin-top:5px;font-size:11px;color:#8A8F9B;}
.l-modal-input{margin-top:14px;height:44px;border-radius:10px;background:#F2F1ED;display:flex;align-items:center;padding:0 12px;font-family:Menlo,monospace;font-size:14px;letter-spacing:.14em;color:#1D1D1F;}
.l-modal-hint{margin-top:6px;font-size:9.5px;color:#A9ACB0;}
.l-modal-actions{display:flex;gap:8px;margin-top:16px;}
.l-modal-actions span{flex:1;height:40px;border-radius:10px;background:#F2F1ED;display:flex;align-items:center;justify-content:center;font-size:12px;color:#4E5157;}
.l-modal-actions span.ok{background:#1D1D1F;color:#FFFFFF;}

.l-spec{padding:18px;height:380px;}
.l-spec-title{font-size:11px;letter-spacing:.12em;color:#8A8F9B;}
.l-spec-demo{margin-top:12px;background:#FFFFFF;border-radius:12px;padding:10px 12px;}
.l-demo-head{display:flex;align-items:baseline;gap:6px;padding-bottom:6px;}
.l-demo-head b{font-size:18px;font-weight:700;line-height:1;}
.l-demo-head span{font-size:10px;color:#8A8F9B;}
.l-demo-head em{margin-left:auto;font-style:normal;font-size:9px;color:#B0B3B0;}
.l-demo-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid #F0EFEA;}
.l-demo-row span{width:6px;height:6px;border-radius:50%;background:#FBF1D6;border:1px solid #E8A400;display:block;flex:none;margin-left:34px;}
.l-demo-row b{font-size:11.5px;font-weight:500;}
.l-demo-row em{margin-left:auto;font-style:normal;font-size:9.5px;color:#B0B3B0;font-feature-settings:"tnum";}
.l-spec-notes{margin-top:14px;}
.l-spec-notes div{display:flex;flex-direction:column;gap:2px;padding:8px 0;border-bottom:1px solid #E6E5E0;}
.l-spec-notes b{font-size:11px;font-weight:600;}
.l-spec-notes span{font-size:9.5px;color:#8A8F9B;}
.l-spec-colors{display:flex;height:24px;margin-top:12px;border:1px solid #E6E5E0;border-radius:6px;overflow:hidden;}
.l-spec-colors span{flex:1;}
.l-spec-caps{margin-top:8px;font-size:8.5px;line-height:1.6;color:#9A9EA3;}

.l-share{position:absolute;z-index:2;}
.l-share-label-board{font-size:11px;letter-spacing:.1em;color:#8F8878;margin-bottom:10px;}
.l-share-art{width:220px;height:176px;background:#FFFFFF;padding:15px 16px;display:flex;flex-direction:column;position:relative;overflow:hidden;}
.l-share-art img{width:32px;height:32px;display:block;}
.l-share-today{position:absolute;right:14px;top:14px;background:#FBF1D6;border-radius:8px;padding:6px 9px;display:flex;flex-direction:column;align-items:flex-end;}
.l-share-today span{font-size:8px;color:#8B6A1D;letter-spacing:.08em;}
.l-share-today b{font-size:15px;font-weight:700;color:#8B6A1D;}
.l-share-title{margin-top:auto;font-size:20px;font-weight:700;line-height:1.3;color:#1D1D1F;}
.l-share-meta{margin-top:8px;font-size:8.5px;color:#9A9EA3;letter-spacing:.08em;}
;
`;
