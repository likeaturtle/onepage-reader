import { phone, slot, panel, shareCard, chat, board, frameCss } from './frame.mjs';

const todayEvents = [
  { t: '09:00', title: '周会' },
  { t: '14:00', title: '设计评审' },
  { t: '19:30', title: '英语听力' },
];

const dayCard = (d, wd, evs, today = false, density = 3) => `<div class="f-card d${density}">
  <div class="f-cover">
    <div class="f-cover-top"><span class="f-wd">${wd}</span>${today ? '<span class="f-today">今天</span>' : ''}</div>
    <span class="f-day">${d}</span>
    <span class="f-count">${evs.length} 条</span>
  </div>
  <div class="f-body">
    ${evs.map((e) => `<div class="f-ev"><span>${e.t}</span><b>${e.title}</b></div>`).join('')}
    <div class="f-acts"><i>编辑</i><i class="del">删除</i></div>
  </div>
</div>`;

const login = (logo) => phone({
  page: 'pages/login/login', nav: 'custom', screenClass: 'f-screen',
  content: `<div class="f-login">
    <div class="f-login-top">
      <div class="f-tile big"><div class="f-tile-top">周一</div><span>23</span><div class="f-tile-foot">十一月</div></div>
      <div class="f-login-copy"><img class="f-mark" src="${logo}" alt=""><div class="f-brand">墨程CalCal</div><div class="f-tag">把日程写进墨水屏</div></div>
    </div>
    <div class="f-login-card">
      <div class="f-card-title">登录后开始连接设备</div>
      <p>用微信身份识别你的账号，日程会同时保存在云端，没带设备也能看。</p>
      <div class="f-cta">微信一键登录</div>
      <p class="f-note">首次在真机上使用时，请允许微信访问蓝牙。登录状态保存在本机，可在「我的」中退出。</p>
    </div>
    <div class="f-api">接口 calcal.acenova.tech</div>
  </div>`,
});

const add = () => phone({
  page: 'pages/index/index', title: '墨程CalCal', tab: '添加', screenClass: 'f-screen',
  content: `<div class="f-add">
    <div class="f-add-head">
      <div class="f-tile mid"><div class="f-tile-top">周二</div><span>24</span><div class="f-tile-foot">十一月</div></div>
      <div class="f-add-title"><div class="f-kicker">新日程</div><div class="f-h1">项目评审</div><div class="f-sub">15:00 — 16:00 · 会议室 A</div></div>
    </div>

    <div class="f-device"><span class="dot"></span><b>墨程CalCal</b><span>已连接</span><i>同步</i><i>休眠</i><i class="del">断开</i></div>

    <div class="f-form">
      <div class="f-field"><span>日期</span><b>11月24日 周二</b><i>›</i></div>
      <div class="f-field"><span>时间</span><b>15:00 — 16:00</b><i>›</i></div>
      <div class="f-field"><span>标题</span><b>项目评审</b><i>12/95</i></div>
      <div class="f-field"><span>备注</span><b>会议室 A · 带上打印稿</b><i>30/191</i></div>
      <div class="f-voice-text"><span>语音原文</span>明天下午三点项目评审，会议室 A，带上打印稿</div>
      <div class="f-voice"><span class="f-mic"><i></i></span><b>按住 说话</b><em>解析日程</em></div>
      <div class="f-save">保存日程</div>
    </div>

    <div class="f-mini"><span>保存后出现在</span><b>24 周二</b><em>15:00 项目评审</em></div>
    <div class="f-log">查看蓝牙协议日志</div>
  </div>`,
});

const agenda = () => phone({
  page: 'pages/calendar/calendar', title: '墨程CalCal', tab: '日程', screenClass: 'f-screen',
  content: `<div class="f-ag">
    <div class="f-ag-head"><div><div class="f-kicker">2026</div><div class="f-month">十一月</div></div><div class="f-ag-meta">6 条 · 已同步</div><div class="f-nav"><span>&lsaquo;</span><span>&rsaquo;</span></div></div>
    <div class="f-feed">
      <div class="f-col">
        ${dayCard(23, '周一', todayEvents, true, 3)}
        ${dayCard(26, '周四', [{ t: '18:00', title: '牙医复诊' }], false, 1)}
        <div class="f-write"><span>＋</span>写一条</div>
      </div>
      <div class="f-col">
        ${dayCard(24, '周二', [{ t: '10:00', title: '客户电话' }, { t: '15:00', title: '项目评审' }], false, 2)}
        <div class="f-stat"><span>本月</span><b>6<em>条</em></b><i>3 天有安排</i></div>
      </div>
    </div>
    <div class="f-ag-foot">连接设备后自动同步到墨水屏</div>
  </div>`,
});

const profile = () => phone({
  page: 'pages/profile/profile', title: '墨程CalCal', tab: '我的', screenClass: 'f-screen',
  content: `<div class="f-me">
    <div class="f-me-head"><div class="f-tile me"><span>林</span></div><div><div class="f-name">林屿</div><div class="f-uid">用户 ID u_7f3a9c21</div></div><span class="f-save-link">保存</span></div>
    <div class="f-grid">
      <div class="f-cell wide"><span>我的设备</span><b>墨程CalCal</b><i>绑定于 2026-11-09</i></div>
      <div class="f-cell"><span>应用</span><b>墨程CalCal</b></div>
      <div class="f-cell"><span>客户端版本</span><b>体验版</b></div>
      <div class="f-cell"><span>接口地址</span><b class="mono">calcal.acenova.tech</b></div>
      <div class="f-cell"><span>设备协议</span><b>proto 3</b></div>
      <div class="f-cell wide explain"><span>关于设备归属</span><b>日程在云端，连接设备后自动双向同步；解绑只解除云端归属，不清除设备密钥。</b></div>
    </div>
    <div class="f-logout">退出登录</div>
  </div>`,
});

/* panels */
const cardCrop = () => `<div class="f-crop">
  <div class="f-crop-feed">
    ${dayCard(23, '周一', todayEvents, true, 3)}
    <div class="f-crop-right">${dayCard(24, '周二', [{ t: '10:00', title: '客户电话' }, { t: '15:00', title: '项目评审' }], false, 2)}</div>
  </div>
  <div class="f-crop-note">封面的深浅 = 那天有几条日程。今天用一枚珊瑚色标签。</div>
</div>`;

const pairingCrop = () => `<div class="f-pair">
  <div class="f-pair-ghost"></div>
  <div class="f-modal">
    <div class="f-modal-head"><span>配对</span></div>
    <div class="f-modal-body">
      <div class="f-modal-title">设备配对</div>
      <div class="f-modal-sub">输入设备屏幕上的 12 位配对码</div>
      <div class="f-modal-input">K7Q4 M2X9 B3TF</div>
      <div class="f-modal-hint">不区分大小写，例如 K7Q4M2X9B3TF</div>
      <div class="f-modal-actions"><span>取消</span><span class="ok">配对</span></div>
    </div>
  </div>
</div>`;

const spec = () => `<div class="f-spec">
  <div class="f-spec-title">日卡的语法</div>
  <div class="f-density">
    <div class="d1"><span>1 条</span></div>
    <div class="d2"><span>2 条</span></div>
    <div class="d3"><span>3 条 +</span></div>
  </div>
  <div class="f-spec-rows">
    <div><b>封面</b><span>日期 40 / 星期 10 / 条数 9</span></div>
    <div><b>卡身</b><span>白卡、10 px 圆角、1 px 边</span></div>
    <div><b>双列</b><span>列宽 158、间距 10、错落高度</span></div>
  </div>
  <div class="f-spec-colors"><span style="background:#22345A"></span><span style="background:#5A6E80"></span><span style="background:#C9D2DA"></span><span style="background:#C4553B"></span></div>
  <div class="f-spec-caps">密度三档 / 珊瑚只给今天与删除</div>
</div>`;

const shareArt = () => `<div class="f-share-art">
  <div class="f-share-tiles"><span class="a">23</span><span class="b">24</span></div>
  <div class="f-share-title">这个月，<br>写在纸上</div>
  <div class="f-share-meta">墨程CalCal · 十一月</div>
</div>`;

export function dirF(logo) {
  const body = `
  ${slot({ x: 56, y: 330, scale: 0.86, label: '日程', note: '双列日卡 · 高度随事件数', node: agenda() })}
  ${slot({ x: 410, y: 380, scale: 0.8, label: '添加', note: '日期封面 + 一张正在写的卡', node: add() })}
  ${slot({ x: 740, y: 360, scale: 0.8, label: '我的', note: '信息做成小卡格', node: profile() })}
  ${slot({ x: 1070, y: 400, scale: 0.76, label: '登录', note: '日期封面开场', node: login(logo) })}
  ${panel({ x: 56, y: 1120, w: 375, h: 380, label: '日卡 · 1:1', note: '深浅 = 事件数', node: cardCrop() })}
  ${panel({ x: 463, y: 1120, w: 375, h: 380, label: '配对 · 1:1', note: '封面头 + 白卡', node: pairingCrop() })}
  ${panel({ x: 870, y: 1120, w: 300, h: 380, label: '密度与卡', note: '三档封面', node: spec() })}
  <div class="f-share" style="left:1180px;top:1096px">
    <div class="f-share-label-board">转发卡片 · 5:4</div>
    ${chat({ children: shareCard({ title: '这个月，写在纸上', artwork: shareArt(), icon: `<img src="${logo}" alt="">` }) })}
  </div>
  <div class="f-board-tiles"><span class="a">23</span><span class="b">24</span></div>`;

  const html = board({
    title: '日卡',
    kicker: '备选 C1 · 秒数轮盘｜App 07 中文内容瀑布流',
    lede: '把月历拆成一面日卡墙：一天一张卡，封面是日期，深浅是那天的忙碌程度，两列错落着往下看。',
    meta: '<b>form 来自</b> 日历一天一张卡 · <b>主入口</b> 最近使用 · <b>借的</b> 双列错落 + 卡片高度由内容量决定',
    body,
    cls: 'f-board',
  });
  return html.replace('__CSS__', frameCss + css);
}

const css = `
.f-board .board{height:1560px;}
.f-board{--paper:#F2F0EA;--ink:#1B1D1F;--muted:#7D7C74;--line:#E7E4DA;--navy:#22345A;
  --nav-bg:#F2F0EA;--nav-fg:#1B1D1F;--tab-bg:#FFFFFF;--tab-on:#22345A;--tab-dim:#B5B2A7;--tab-border:#E7E4DA;
  --fg:#1B1D1F;--label:#3A3B3D;--label-dim:#7D7C74;
  background:#E8E4D9;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;}
.f-board .board-kicker{color:#8A8577;}
.f-board .board-head h1{font-size:62px;font-weight:700;letter-spacing:-.02em;color:#1B1D1F;margin-top:6px;}
.f-board .board-lede{color:#6D6A5F;font-size:15px;max-width:620px;}
.f-board .board-meta{color:#8A8577;}
.f-board .board-meta b{color:#6D6A5F;}
.f-board .slot,.f-board .panel,.f-board .f-share{position:absolute;z-index:2;}
.f-board-tiles{position:absolute;right:56px;top:44px;display:flex;align-items:flex-start;z-index:1;}
.f-board-tiles span{display:flex;align-items:flex-end;justify-content:flex-start;padding:14px;font-family:-apple-system,"PingFang SC",sans-serif;font-size:64px;font-weight:700;line-height:1;color:#fff;border-radius:14px;width:150px;height:150px;box-sizing:border-box;}
.f-board-tiles span.a{background:#22345A;position:relative;z-index:2;}
.f-board-tiles span.b{background:#5A6E80;margin-left:-40px;margin-top:56px;opacity:.92;}

.f-screen{--paper:#F2F0EA;}
.f-tile{background:#22345A;color:#fff;border-radius:12px;padding:10px 11px;display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;flex:none;}
.f-tile span{font-size:40px;font-weight:700;line-height:.9;letter-spacing:-.02em;font-feature-settings:"tnum";}
.f-tile-top{font-size:9px;letter-spacing:.1em;color:rgba(255,255,255,.66);}
.f-tile-foot{font-size:9px;letter-spacing:.06em;color:rgba(255,255,255,.7);}
.f-tile.big{width:142px;height:142px;}
.f-tile.big span{font-size:60px;}
.f-tile.mid{width:96px;height:96px;border-radius:10px;}
.f-tile.mid span{font-size:36px;}
.f-tile.me{width:58px;height:58px;align-items:center;justify-content:center;border-radius:12px;}
.f-tile.me span{font-size:22px;font-weight:600;}

.f-login{height:100%;padding:96px 24px 26px;display:flex;flex-direction:column;}
.f-login-top{display:flex;align-items:flex-start;gap:16px;}
.f-login-copy{padding-top:6px;min-width:0;}
.f-mark{display:block;width:44px;height:44px;}
.f-brand{margin-top:8px;font-size:25px;font-weight:700;letter-spacing:.01em;color:#1B1D1F;}
.f-tag{margin-top:5px;font-size:11px;line-height:1.5;color:#8A8577;letter-spacing:.06em;}
.f-login-card{margin-top:44px;background:#FFFFFF;border-radius:14px;border:1px solid #E7E4DA;padding:20px 18px 16px;}
.f-card-title{font-size:18px;font-weight:700;}
.f-login-card p{margin:8px 0 16px;font-size:12.5px;line-height:1.8;color:#6D6A5F;}
.f-cta{height:48px;border-radius:24px;background:#22345A;color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;letter-spacing:.06em;}
.f-note{margin:12px 0 0 !important;font-size:11px;line-height:1.75;color:#9A9587;}
.f-api{margin-top:auto;text-align:center;font-size:10px;color:#A8A294;}

.f-add{padding:16px 18px 18px;}
.f-add-head{display:flex;align-items:flex-start;gap:14px;}
.f-add-title{flex:1;min-width:0;padding-top:2px;}
.f-kicker{font-size:10px;letter-spacing:.14em;color:#8A8577;}
.f-h1{margin-top:4px;font-size:21px;font-weight:700;line-height:1.25;}
.f-sub{margin-top:5px;font-size:11px;color:#6D6A5F;font-feature-settings:"tnum";}
.f-device{display:flex;align-items:center;gap:6px;height:32px;font-size:10px;color:#8A8577;padding:0 2px;}
.f-device .dot{width:5px;height:5px;border-radius:50%;background:#2C8A6F;}
.f-device b{font-size:11px;font-weight:600;color:#1B1D1F;}
.f-device i{margin-left:auto;font-style:normal;font-size:10.5px;color:#6D6A5F;}
.f-device i + i{margin-left:8px;}
.f-device i.del{color:#C4553B;}
.f-form{background:#fff;border:1px solid #E7E4DA;border-radius:12px;padding:4px 14px 12px;}
.f-field{display:flex;align-items:center;gap:8px;height:38px;border-top:1px solid #F0EDE4;}
.f-field:first-child{border-top:none;}
.f-field span{width:32px;flex:none;font-size:10px;color:#9A9587;}
.f-field b{font-size:12.5px;font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.f-field i{margin-left:auto;font-style:normal;font-size:9px;color:#B5B2A7;}
.f-voice{display:flex;align-items:center;gap:9px;height:44px;border-top:1px solid #F0EDE4;}
.f-mic{width:36px;height:36px;border-radius:18px;background:#1B1D1F;display:flex;align-items:center;justify-content:center;flex:none;}
.f-mic i{width:2px;height:12px;border-radius:1px;background:#fff;display:block;}
.f-voice b{font-size:11.5px;font-weight:500;}
.f-voice em{margin-left:auto;font-style:normal;font-size:10.5px;color:#22345A;}
.f-save{height:44px;border-radius:22px;background:#22345A;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;letter-spacing:.08em;margin-top:2px;}
.f-preview{margin-top:10px;}
.f-preview-head{font-size:9.5px;color:#8A8577;margin-bottom:6px;letter-spacing:.04em;}
.f-preview .f-card{width:160px;}
.f-voice-text{margin-top:8px;padding:7px 9px;background:#F7F5F0;border-radius:8px;font-size:11px;line-height:1.6;color:#4E4F49;}
.f-voice-text span{display:block;font-size:8.5px;letter-spacing:.06em;color:#9A9587;margin-bottom:2px;}
.f-mini{display:flex;align-items:center;gap:7px;margin-top:10px;padding:8px 10px;background:#fff;border:1px dashed #D9D4C7;border-radius:8px;font-size:10px;color:#9A9587;}
.f-mini b{font-size:11px;color:#22345A;}
.f-mini em{font-style:normal;margin-left:auto;font-size:10px;color:#6D6A5F;}
.f-log{margin-top:8px;text-align:center;font-size:10px;color:#A8A294;}

.f-ag{padding:14px 16px 14px;display:flex;flex-direction:column;min-height:100%;}
.f-ag-head{display:flex;align-items:flex-end;gap:8px;}
.f-month{font-size:25px;font-weight:700;letter-spacing:-.01em;margin-top:2px;}
.f-ag-meta{font-size:10px;color:#8A8577;padding-bottom:4px;}
.f-nav{margin-left:auto;display:flex;gap:6px;}
.f-nav span{width:28px;height:28px;border-radius:14px;border:1px solid #DAD5C8;display:flex;align-items:center;justify-content:center;font-size:14px;color:#4E4F49;}
.f-feed{display:flex;gap:10px;margin-top:12px;}
.f-col{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;}
.f-card{background:#fff;border:1px solid #E7E4DA;border-radius:10px;overflow:hidden;}
.f-cover{height:82px;padding:9px 10px;display:flex;flex-direction:column;justify-content:space-between;color:#fff;position:relative;}
.f-card.d1 .f-cover{background:#C9D2DA;color:#1B1D1F;}
.f-card.d2 .f-cover{background:#5A6E80;}
.f-card.d3 .f-cover{background:#22345A;}
.f-cover-top{display:flex;align-items:center;justify-content:space-between;}
.f-wd{font-size:9px;letter-spacing:.08em;opacity:.82;}
.f-today{font-size:9px;letter-spacing:.06em;background:#C4553B;color:#fff;border-radius:6px;padding:2px 5px;}
.f-day{font-size:38px;font-weight:700;line-height:.85;letter-spacing:-.02em;font-feature-settings:"tnum";}
.f-count{position:absolute;right:10px;bottom:9px;font-size:9px;opacity:.75;letter-spacing:.04em;}
.f-body{padding:7px 10px 8px;}
.f-ev{display:flex;align-items:baseline;gap:6px;padding:4px 0;border-top:1px solid #F2EFE7;}
.f-ev:first-child{border-top:none;}
.f-ev span{font-size:10px;color:#9A9587;font-feature-settings:"tnum";flex:none;}
.f-ev b{font-size:13px;font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.f-acts{display:flex;justify-content:flex-end;gap:8px;padding-top:6px;margin-top:4px;border-top:1px solid #F2EFE7;}
.f-acts i{font-style:normal;font-size:10.5px;color:#A8A294;}
.f-acts i.del{color:#C4553B;}
.f-write{border:1px dashed #C9C3B5;border-radius:10px;height:62px;display:flex;align-items:center;justify-content:center;gap:5px;font-size:11px;color:#8A8577;}
.f-write span{font-size:14px;color:#22345A;}
.f-stat{background:#22345A;border-radius:10px;padding:12px 12px 10px;color:#fff;}
.f-stat span{font-size:9px;letter-spacing:.12em;color:rgba(255,255,255,.6);}
.f-stat b{display:block;margin-top:4px;font-size:30px;font-weight:700;line-height:1;}
.f-stat b em{font-style:normal;font-size:10px;font-weight:400;margin-left:2px;color:rgba(255,255,255,.7);}
.f-stat i{display:block;margin-top:4px;font-style:normal;font-size:9px;color:rgba(255,255,255,.6);}
.f-ag-foot{text-align:center;font-size:9.5px;color:#A8A294;margin-top:auto;padding-top:9px;}

.f-me{padding:16px 16px 20px;display:flex;flex-direction:column;min-height:100%;}
.f-me-head{display:flex;align-items:center;gap:12px;padding:2px 2px 14px;}
.f-name{font-size:20px;font-weight:700;}
.f-uid{margin-top:3px;font-size:9.5px;color:#8A8577;}
.f-save-link{margin-left:auto;font-size:10.5px;color:#22345A;}
.f-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;}
.f-cell{background:#fff;border:1px solid #E7E4DA;border-radius:10px;padding:10px 11px;display:flex;flex-direction:column;gap:4px;min-width:0;}
.f-cell.wide{grid-column:span 2;}
.f-cell span{font-size:9px;color:#9A9587;letter-spacing:.06em;}
.f-cell b{font-size:12px;font-weight:500;color:#1B1D1F;line-height:1.35;}
.f-cell i{font-style:normal;font-size:9.5px;color:#A8A294;}
.f-cell .mono{font-family:Menlo,monospace;font-size:9px;}
.f-cell.explain b{font-weight:400;font-size:10.5px;line-height:1.7;color:#6D6A5F;}
.f-logout{margin-top:auto;padding-top:14px;text-align:center;font-size:11px;color:#C4553B;letter-spacing:.06em;}

.panel-body{background:#F2F0EA;}
.f-crop{padding:16px;height:380px;}
.f-crop-feed{display:flex;gap:10px;}
.f-crop .f-card{width:50%;}
.f-crop-right{padding-top:20px;width:50%;}
.f-crop .f-card{width:100%;}
.f-crop-note{margin-top:12px;font-size:10px;line-height:1.8;color:#8A8577;}
.f-pair{position:relative;height:380px;background:#F2F0EA;overflow:hidden;}
.f-pair-ghost{position:absolute;left:24px;right:24px;top:30px;height:150px;border-radius:10px;background:#E7E4DA;opacity:.55;}
.f-modal{position:absolute;left:34px;right:34px;top:62px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 20px 50px rgba(20,20,20,.16);}
.f-modal-head{height:54px;background:#22345A;display:flex;align-items:flex-end;padding:0 16px 10px;}
.f-modal-head span{font-size:11px;letter-spacing:.16em;color:rgba(255,255,255,.72);}
.f-modal-body{padding:16px 16px 14px;}
.f-modal-title{font-size:18px;font-weight:700;}
.f-modal-sub{margin-top:4px;font-size:10.5px;color:#8A8577;}
.f-modal-input{margin-top:12px;height:42px;border-radius:10px;background:#F2F0EA;display:flex;align-items:center;padding:0 12px;font-family:Menlo,monospace;font-size:13.5px;letter-spacing:.14em;}
.f-modal-hint{margin-top:6px;font-size:9px;color:#A8A294;}
.f-modal-actions{display:flex;gap:8px;margin-top:14px;}
.f-modal-actions span{flex:1;height:40px;border-radius:20px;background:#F2F0EA;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:#4E4F49;}
.f-modal-actions span.ok{background:#22345A;color:#fff;}

.f-spec{padding:18px;height:380px;}
.f-spec-title{font-size:10.5px;letter-spacing:.12em;color:#8A8577;}
.f-density{display:flex;gap:7px;margin-top:12px;}
.f-density div{flex:1;height:76px;border-radius:8px;display:flex;align-items:flex-end;padding:8px;}
.f-density span{font-size:9px;color:#fff;}
.f-density .d1{background:#C9D2DA;}
.f-density .d1 span{color:#1B1D1F;}
.f-density .d2{background:#5A6E80;}
.f-density .d3{background:#22345A;}
.f-spec-rows{margin-top:14px;}
.f-spec-rows div{padding:8px 0;border-bottom:1px solid #E7E4DA;}
.f-spec-rows b{display:block;font-size:10.5px;font-weight:600;}
.f-spec-rows span{display:block;margin-top:2px;font-size:9px;color:#8A8577;}
.f-spec-colors{display:flex;height:24px;margin-top:12px;border-radius:6px;overflow:hidden;border:1px solid #E7E4DA;}
.f-spec-colors span{flex:1;}
.f-spec-caps{margin-top:8px;font-size:8.5px;color:#9A9587;line-height:1.6;}

.f-share{position:absolute;z-index:2;}
.f-share-label-board{font-size:11px;letter-spacing:.1em;color:#8A8577;margin-bottom:10px;}
.f-share-art{width:220px;height:176px;background:#FFFFFF;padding:14px 15px;display:flex;flex-direction:column;position:relative;overflow:hidden;}
.f-share-tiles{display:flex;gap:8px;}
.f-share-tiles span{width:54px;height:54px;border-radius:8px;display:flex;align-items:flex-end;padding:6px;font-size:24px;font-weight:700;color:#fff;line-height:1;}
.f-share-tiles .a{background:#22345A;}
.f-share-tiles .b{background:#5A6E80;margin-top:14px;}
.f-share-title{margin-top:auto;font-size:19px;font-weight:700;line-height:1.3;color:#1B1D1F;}
.f-share-meta{margin-top:6px;font-size:8.5px;color:#8A8577;letter-spacing:.08em;}
;
`;
