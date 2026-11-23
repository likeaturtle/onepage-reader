import { phone, slot, panel, shareCard, chat, board, frameCss } from './frame.mjs';

const events = [
  { t: '09:00', title: '周会', note: '5 楼小会议室' },
  { t: '14:00', title: '设计评审', note: '带上打印稿' },
  { t: '19:30', title: '英语听力', note: '第 4 单元' },
];

const months = [
  ['一月', '霜青', '#6E8290'],
  ['二月', '柳黄', '#A8A06A'],
  ['三月', '桃', '#C08A7C'],
  ['四月', '竹青', '#7C8E70'],
  ['五月', '榴红', '#A5513D'],
  ['六月', '荷', '#96707F'],
  ['七月', '靛', '#3F5A73'],
  ['八月', '桂', '#B08A4A'],
  ['九月', '秋香', '#8C7A45'],
  ['十月', '赭', '#9A5B3C'],
  ['十一月', '玄青', '#35485C'],
  ['十二月', '雪', '#8A8F91'],
];

const dayCard = (d, wd, count, list, today = false) => `
<div class="c-day">
  <div class="c-day-head ${today ? 'on' : ''}">
    <span class="c-day-num">${d}</span>
    <span class="c-day-wd">${wd}${today ? ' · 今天' : ''}</span>
    <span class="c-day-count">${count} 条</span>
  </div>
  <div class="c-day-body">
    ${list.map((e) => `<div class="c-ev">
      <span class="c-time">${e.t}</span>
      <div class="c-ev-main"><b>${e.title}</b>${e.note ? `<span>${e.note}</span>` : ''}</div>
      <span class="c-ev-act">编辑<i>删除</i></span>
    </div>`).join('')}
  </div>
</div>`;

const login = (logo) => phone({
  page: 'pages/login/login', nav: 'custom', inverted: true, screenClass: 'c-screen',
  content: `<div class="c-login">
    <div class="c-cover">
      <div class="c-cover-year">2026</div>
      <div class="c-sticker"><img src="${logo}" alt=""></div>
      <div class="c-cover-brand">墨程CalCal</div>
      <div class="c-cover-tag">把日程写进墨水屏</div>
      <div class="c-cover-foot"><span>十一月</span><i></i><span>玄青</span></div>
    </div>
    <div class="c-sheet">
      <div class="c-sheet-title">登录后开始连接设备</div>
      <p class="c-sheet-copy">用微信身份识别你的账号，日程会同时保存在云端，没带设备也能看。</p>
      <div class="c-cta">微信一键登录</div>
      <p class="c-note">首次在真机上使用时，请允许微信访问蓝牙。登录状态保存在本机，可在「我的」中退出。</p>
      <div class="c-api">接口 calcal.acenova.tech</div>
    </div>
  </div>`,
});

const add = () => phone({
  page: 'pages/index/index', title: '墨程CalCal', tab: '添加', screenClass: 'c-screen',
  content: `<div class="c-add">
    <div class="c-band">
      <div>
        <div class="c-band-kicker">十一月 · 2026</div>
        <div class="c-band-date"><span class="c-band-big">23</span><span class="c-band-wd">日 · 周一</span></div>
      </div>
      <div class="c-band-right"><span class="c-band-count">今天 3 条</span><span class="c-band-sync">云端已同步</span></div>
    </div>

    <div class="c-content">
      <div class="c-card c-device-card">
        <span class="c-dot"></span><b>墨程CalCal</b><span class="c-pill">已连接</span>
        <span class="c-device-acts"><i>同步</i><i>休眠</i><i class="danger">断开</i></span>
      </div>

      <div class="c-card c-voice">
        <div class="c-card-head"><span>说一句</span><em>AI 填好，核对后保存</em></div>
        <p class="c-voice-text">明天下午三点项目评审，会议室 A，带上打印稿</p>
        <div class="c-voice-row">
          <span class="c-hold"><span class="c-mic"></span>按住 说话</span>
          <span class="c-parse">解析</span>
        </div>
      </div>

      <div class="c-card c-form">
        <div class="c-card-head"><span>日程</span><em>已按语音填好</em></div>
        <div class="c-form-row">
          <span class="c-chip">11月24日 周二</span>
          <span class="c-chip">15:00 — 16:00</span>
        </div>
        <div class="c-field"><span class="c-flabel">标题</span><span class="c-fvalue">项目评审</span><span class="c-count">12/95</span></div>
        <div class="c-field"><span class="c-flabel">备注</span><span class="c-fvalue">会议室 A · 带上打印稿</span><span class="c-count">30/191</span></div>
        <div class="c-save">保存日程</div>
      </div>
      <div class="c-log">查看蓝牙协议日志</div>
    </div>
  </div>`,
});

const agenda = () => phone({
  page: 'pages/calendar/calendar', title: '墨程CalCal', tab: '日程', screenClass: 'c-screen',
  content: `<div class="c-ag">
    <div class="c-band c-ag-band">
      <div>
        <div class="c-band-kicker">2026</div>
        <div class="c-band-date"><span class="c-band-big serif">十一月</span></div>
      </div>
      <div class="c-band-right"><span class="c-band-count">6 条日程</span><span class="c-band-sync">云端 · 已同步</span></div>
      <div class="c-band-nav"><span>&lsaquo;</span><span>&rsaquo;</span></div>
    </div>
    <div class="c-content c-ag-content">
      ${dayCard(23, '周一', 3, events, true)}
      ${dayCard(24, '周二', 2, [
        { t: '10:00', title: '客户电话', note: '' },
        { t: '15:00', title: '项目评审', note: '会议室 A' },
      ])}
      ${dayCard(26, '周四', 1, [{ t: '18:00', title: '牙医复诊', note: '口腔医院 3 楼' }])}
      <div class="c-ag-foot">本月还有 3 条 · 连接设备后自动同步</div>
    </div>
  </div>`,
});

const profile = () => phone({
  page: 'pages/profile/profile', title: '墨程CalCal', tab: '我的', screenClass: 'c-screen',
  content: `<div class="c-prof">
    <div class="c-band c-prof-band">
      <div class="c-prof-left"><span class="c-avatar">林</span><div><div class="c-prof-name">林屿</div><div class="c-prof-meta">体验版 · 已登录</div></div></div>
      <span class="c-prof-id">u_7f3a9c21</span>
    </div>
    <div class="c-content c-prof-content">
      <div class="c-card c-namecard">
        <div class="c-field"><span class="c-flabel">昵称</span><span class="c-fvalue">林屿</span></div>
        <span class="c-save-small">保存</span>
      </div>

      <div class="c-card">
        <div class="c-card-title">我的设备</div>
        <div class="c-devrow">
          <div><b>墨程CalCal</b><span>绑定于 2026-11-09 · 固件 1.0.0</span></div>
          <i>解绑</i>
        </div>
      </div>

      <div class="c-card">
        <div class="c-card-title">信息</div>
        <div class="c-kv"><span>应用</span><span>墨程CalCal</span></div>
        <div class="c-kv"><span>登录方式</span><span>微信登录</span></div>
        <div class="c-kv"><span>接口地址</span><span class="c-mono">calcal.acenova.tech</span></div>
        <div class="c-kv"><span>客户端版本</span><span>体验版</span></div>
        <div class="c-kv"><span>设备协议</span><span>proto 3</span></div>
      </div>

      <div class="c-card">
        <div class="c-card-title">关于设备归属</div>
        <p>日程保存在云端，连接设备后自动双向同步，设备端删除也会同步删除云端对应日程。登录只用于账号归属，解绑不删除设备密钥。</p>
      </div>
      <div class="c-logout">退出登录</div>
    </div>
  </div>`,
});

/* ---------------- panels ---------------- */

const weeks = ['日', '一', '二', '三', '四', '五', '六'];
const marked = { 23: true, 24: true, 26: true, 28: true };
const cells = [];
for (let i = 0; i < 35; i += 1) {
  const d = i + 1;
  if (d > 30) cells.push('<span class="c-cal-cell out"></span>');
  else cells.push(`<span class="c-cal-cell ${d === 24 ? 'sel' : d === 23 ? 'today' : ''} ${[0, 6].includes(i % 7) ? 'we' : ''}"><span class="c-cal-d">${d}</span>${marked[d] ? '<i class="c-cal-dot"></i>' : ''}</span>`);
}

const calendarCrop = () => `<div class="c-crop">
  <div class="c-cal-head">
    <div><div class="c-cal-kicker">选择日期</div><div class="c-cal-month">十一月<em>2026</em></div></div>
    <div class="c-cal-nav"><span>&lsaquo;</span><span class="today">今天</span><span>&rsaquo;</span></div>
  </div>
  <div class="c-cal-week">${weeks.map((w) => `<span>${w}</span>`).join('')}</div>
  <div class="c-cal-grid">${cells.join('')}</div>
  <div class="c-cal-legend"><span><i></i>今天</span><span><b></b>已选</span><span><em></em>有日程</span></div>
  <div class="c-cal-sum"><span>已选</span><b>11月24日 周二</b><em>15:00 — 16:00</em></div>
</div>`;

const pairingCrop = () => `<div class="c-pair">
  <div class="c-pair-dim"></div>
  <div class="c-modal">
    <div class="c-modal-strip"></div>
    <div class="c-modal-body">
      <div class="c-modal-title">设备配对</div>
      <div class="c-modal-sub">输入设备屏幕上的 12 位配对码</div>
      <div class="c-modal-input">K7Q4 M2X9 B3TF</div>
      <div class="c-modal-hint">不区分大小写，例如 K7Q4M2X9B3TF</div>
      <div class="c-modal-actions"><span>取消</span><span class="ok">配对</span></div>
    </div>
  </div>
</div>`;

const colorCard = () => `<div class="c-colors">
  <div class="c-colors-title">十二个月的节令色</div>
  <div class="c-colors-grid">
    ${months.map(([m, name, hex], i) => `<div class="c-swatch ${i === 10 ? 'now' : ''}">
      <span style="background:${hex}"></span>
      <b>${m}</b><i>${name}</i>
      ${i === 10 ? '<em>现在</em>' : ''}
    </div>`).join('')}
  </div>
  <div class="c-colors-foot">颜色只回答一件事：现在是一年中的哪一段。<br>同一天里，只用这一个色相做强调。</div>
</div>`;

const shareArt = (logo) => `<div class="c-share-art">
  <div class="c-share-sticker"><img src="${logo}" alt=""></div>
  <div class="c-share-title">把日程<br>写进墨水屏</div>
  <div class="c-share-meta"><span>十一月 · 玄青</span><span>墨程CalCal</span></div>
</div>`;

export function dirC(logo) {
  const strip = `<div class="c-yearstrip">${months.map(([m, name, hex], i) => `<span class="${i === 10 ? 'now' : ''}" style="background:${hex}"></span>`).join('')}</div>
  <div class="c-yearstrip-caption">2026 · 十二节令色 <b>十一月 玄青 #35485C</b></div>`;

  const body = `
  ${strip}
  ${slot({ x: 56, y: 380, scale: 0.86, label: '添加', note: '月份色带 + 三张卡', node: add() })}
  ${slot({ x: 430, y: 404, scale: 0.8, label: '日程', note: '每天一条色带抬头', node: agenda() })}
  ${slot({ x: 754, y: 392, scale: 0.8, label: '我的', note: '头像落在色带上', node: profile() })}
  ${slot({ x: 1078, y: 412, scale: 0.78, label: '登录', note: '季节色封面 + 纸卡', node: login(logo) })}
  ${panel({ x: 56, y: 1140, w: 375, h: 380, label: '月历 · 1:1', note: '选中的日子用当月色', node: calendarCrop() })}
  ${panel({ x: 463, y: 1140, w: 375, h: 380, label: '配对弹层 · 1:1', note: '色带抬头 + 等宽码', node: pairingCrop() })}
  ${panel({ x: 870, y: 1140, w: 300, h: 380, label: '节令色', note: '12 段，当前段最重', node: colorCard() })}
  <div class="c-share" style="left:1176px;top:1116px">
    <div class="c-share-label-board">转发卡片 · 5:4</div>
    ${chat({ children: shareCard({ title: '把日程写进墨水屏', artwork: shareArt(logo), icon: `<img src="${logo}" alt="">` }) })}
  </div>`;

  const html = board({
    title: '节令',
    kicker: '方向三 · 秒数轮盘｜East 07 节气色谱',
    lede: '日历跟着节气走。每个月有一个属于它的颜色，整页的强调色都从这一个色里长出来；墨水屏替它记住黑白，手机替它记住季节。',
    meta: '<b>form 来自</b> 月份色带与月历格 · <b>主入口</b> 最近使用 · <b>借的</b> 颜色随时间变化，成为导航',
    body,
    cls: 'c-board',
  });
  return html.replace('__CSS__', frameCss + css);
}

const css = `
.c-board .board{height:1560px;}
.c-board{--season:#35485C;--season-deep:#28384A;--paper:#F4EFE3;--ink:#1F2328;--muted:#9E9885;--faint:#7F7A6A;
  --line:#DCD3C0;--nav-bg:#F4EFE3;--nav-fg:#1F2328;--tab-bg:#F4EFE3;--tab-on:#35485C;--tab-dim:#B3AB97;--tab-border:#E2D9C6;
  --fg:#F1EADA;--label:#E9E1CF;--label-dim:#9E9885;
  background:#1B2429;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#F1EADA;}
.c-board .board-head{top:88px;}
.c-board .board-kicker{color:#A7A192;}
.c-board .board-head h1{font-family:"Songti SC","Noto Serif SC",serif;font-weight:600;font-size:72px;color:#F5EFDF;letter-spacing:.05em;line-height:1.05;}
.c-board .board-lede{color:#C9C2B0;font-size:15px;max-width:600px;}
.c-board .board-meta{color:#9E9885;}
.c-board .board-meta b{color:#C9C2B0;}
.c-yearstrip{position:absolute;left:0;top:0;width:1440px;height:12px;display:flex;}
.c-yearstrip span{flex:1;height:12px;}
.c-yearstrip span.now{flex:1.9;height:18px;position:relative;top:0;}
.c-yearstrip-caption{position:absolute;right:56px;top:30px;font-size:10px;letter-spacing:.12em;color:#9E9885;}
.c-yearstrip-caption b{font-weight:500;color:#D8D0BE;margin-left:14px;letter-spacing:.08em;}

.c-screen{--paper:#F4EFE3;}
.c-screen .nav-title{letter-spacing:.02em;}
.c-login{height:100%;display:flex;flex-direction:column;background:#F4EFE3;}
.c-cover{height:472px;background:linear-gradient(170deg,#3B4F64 0%,#35485C 56%,#2C3D4F 100%);padding:112px 32px 0;position:relative;}
.c-cover-year{font-family:Menlo,monospace;font-size:11px;letter-spacing:.32em;color:rgba(247,243,232,.55);}
.c-sticker{width:92px;height:92px;background:#F7F3E8;border-radius:5px;display:flex;align-items:center;justify-content:center;margin-top:22px;box-shadow:0 8px 0 rgba(0,0,0,.18);transform:rotate(-1.2deg);}
.c-sticker img{width:70px;height:70px;display:block;}
.c-cover-brand{margin-top:24px;font-size:32px;font-weight:600;color:#F7F3E8;letter-spacing:.03em;}
.c-cover-tag{margin-top:8px;font-size:12px;letter-spacing:.24em;color:rgba(247,243,232,.66);}
.c-cover-foot{position:absolute;left:32px;right:32px;bottom:40px;display:flex;align-items:center;gap:10px;font-size:10px;letter-spacing:.2em;color:rgba(247,243,232,.56);}
.c-cover-foot i{flex:1;height:1px;background:rgba(247,243,232,.22);}
.c-sheet{margin-top:-20px;flex:1;background:#F4EFE3;border-radius:18px 18px 0 0;padding:26px 30px 22px;position:relative;box-shadow:0 -10px 24px rgba(20,30,40,.18);}
.c-sheet-title{font-family:"Songti SC",serif;font-size:20px;font-weight:600;color:#1F2328;}
.c-sheet-copy{margin:8px 0 18px;font-size:13px;line-height:1.8;color:#615C50;}
.c-cta{height:50px;border-radius:25px;background:#35485C;color:#F7F3E8;font-size:15px;letter-spacing:.1em;display:flex;align-items:center;justify-content:center;}
.c-note{margin:14px 0 0;font-size:12px;line-height:1.75;color:#8C8676;}
.c-api{margin-top:14px;text-align:center;font-size:10.5px;color:#A7A192;}

.c-add{height:100%;}
.c-band{background:linear-gradient(160deg,#3B4F64,#35485C);color:#F7F3E8;padding:14px 20px 16px;display:flex;align-items:flex-start;justify-content:space-between;}
.c-band-kicker{font-size:11px;letter-spacing:.18em;color:rgba(247,243,232,.62);}
.c-band-date{display:flex;align-items:baseline;gap:8px;margin-top:2px;}
.c-band-big{font-family:"Songti SC",serif;font-size:44px;font-weight:600;line-height:1;letter-spacing:.01em;}
.c-band-big.serif{font-size:34px;}
.c-band-wd{font-size:12px;color:rgba(247,243,232,.78);letter-spacing:.06em;}
.c-band-right{display:flex;flex-direction:column;align-items:flex-end;gap:4px;padding-top:4px;}
.c-band-count{font-size:11.5px;color:rgba(247,243,232,.85);}
.c-band-sync{font-size:11px;color:rgba(247,243,232,.55);}
.c-band-nav{display:flex;gap:6px;padding-top:2px;}
.c-band-nav span{width:30px;height:30px;border-radius:15px;border:1px solid rgba(247,243,232,.3);display:flex;align-items:center;justify-content:center;font-size:16px;color:#F7F3E8;}
.c-content{padding:12px 16px 16px;}
.c-card{background:#FCF9F1;border:1px solid #E4DAC4;border-radius:14px;padding:13px 14px;margin-bottom:11px;}
.c-device-card{display:flex;align-items:center;gap:7px;height:46px;padding:0 14px;}
.c-dot{width:6px;height:6px;border-radius:50%;background:#2C8A6F;flex:none;}
.c-device-card b{font-size:12.5px;font-weight:600;color:#1F2328;}
.c-pill{font-size:10.5px;color:#35485C;background:rgba(53,72,92,.09);padding:2px 6px;border-radius:8px;letter-spacing:.06em;}
.c-device-meta{font-size:10px;color:#8C8676;}
.c-device-acts{margin-left:auto;display:flex;gap:9px;font-size:11.5px;color:#615C50;}
.c-device-acts i{font-style:normal;}
.c-device-acts i.danger{color:#A9512F;}
.c-card-head{display:flex;align-items:baseline;justify-content:space-between;}
.c-card-head span{font-size:12px;font-weight:600;color:#35485C;letter-spacing:.06em;}
.c-card-head em{font-style:normal;font-size:11px;color:#9E9885;}
.c-voice-text{margin:8px 0 0;font-size:13.5px;line-height:1.65;color:#1F2328;}
.c-voice-row{display:flex;gap:8px;margin-top:10px;}
.c-hold{flex:1;height:42px;border-radius:21px;background:#35485C;color:#F7F3E8;display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;letter-spacing:.08em;}
.c-mic{width:6px;height:6px;border-radius:50%;background:#E9B7A4;}
.c-parse{width:62px;height:42px;border-radius:21px;border:1px solid #35485C;color:#35485C;display:flex;align-items:center;justify-content:center;font-size:12px;letter-spacing:.06em;}
.c-form-row{display:flex;gap:8px;margin-top:10px;}
.c-chip{flex:1;height:36px;border-radius:10px;background:#F2ECE0;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:#3A3A34;font-feature-settings:"tnum";}
.c-field{display:flex;align-items:center;gap:8px;height:38px;border-bottom:1px solid #EBE3D2;}
.c-flabel{width:32px;flex:none;font-size:10.5px;color:#9E9885;}
.c-fvalue{font-size:13px;color:#1F2328;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.c-count{margin-left:auto;font-size:11px;color:#B3AB97;flex:none;}
.c-save{margin-top:10px;height:46px;border-radius:22px;background:#35485C;color:#F7F3E8;font-size:14px;letter-spacing:.14em;display:flex;align-items:center;justify-content:center;}

.c-ag{height:100%;}
.c-ag-band{align-items:flex-end;padding-bottom:14px;}
.c-ag-content{padding-top:12px;}
.c-day{margin-bottom:10px;}
.c-day-head{display:flex;align-items:baseline;gap:8px;background:rgba(53,72,92,.08);border:1px solid #E4DAC4;border-bottom:none;border-radius:12px 12px 0 0;padding:8px 12px;}
.c-day-head.on{background:rgba(53,72,92,.16);}
.c-day-num{font-family:"Songti SC",serif;font-size:26px;font-weight:600;line-height:1;color:#35485C;}
.c-day-wd{font-size:11px;color:#615C50;letter-spacing:.04em;}
.c-day-count{margin-left:auto;font-size:11px;color:#8C8676;}
.c-day-body{background:#FCF9F1;border:1px solid #E4DAC4;border-radius:0 0 12px 12px;padding:0 12px;}
.c-ev{display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-top:1px solid #EFE7D7;}
.c-ev:first-child{border-top:none;}
.c-time{width:40px;flex:none;font-size:12px;color:#6D6A5E;font-feature-settings:"tnum";padding-top:2px;}
.c-ev-main{flex:1;min-width:0;}
.c-ev-main b{display:block;font-size:13.5px;font-weight:500;color:#1F2328;line-height:1.35;}
.c-ev-main span{display:block;margin-top:2px;font-size:11.5px;color:#8C8676;line-height:1.4;}
.c-ev-act{flex:none;display:flex;gap:7px;font-size:11px;color:#A7A192;}
.c-ev-act i{font-style:normal;color:#A9512F;}
.c-ag-foot{text-align:center;font-size:11px;color:#A7A192;padding:4px 0 14px;}

.c-prof{height:100%;}
.c-prof-band{align-items:center;padding:18px 20px 26px;}
.c-prof-left{display:flex;align-items:center;gap:12px;}
.c-avatar{width:52px;height:52px;border-radius:26px;background:#F7F3E8;color:#35485C;font-family:"Songti SC",serif;font-size:20px;display:flex;align-items:center;justify-content:center;flex:none;}
.c-prof-name{font-size:21px;font-weight:600;color:#F7F3E8;}
.c-prof-meta{margin-top:3px;font-size:11px;color:rgba(247,243,232,.6);letter-spacing:.06em;}
.c-prof-id{font-family:Menlo,monospace;font-size:10px;color:rgba(247,243,232,.55);}
.c-prof-content{padding-top:0;margin-top:-14px;}
.c-namecard{display:flex;align-items:center;gap:10px;margin-bottom:10px;padding:8px 14px;}
.c-namecard .c-field{flex:1;border-bottom:none;height:34px;}
.c-save-small{font-size:11px;color:#35485C;border:1px solid #35485C;border-radius:14px;padding:6px 14px;flex:none;}
.c-card-title{font-size:12px;font-weight:600;color:#35485C;letter-spacing:.08em;margin-bottom:6px;}
.c-devrow{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:6px 0;}
.c-devrow b{font-size:13px;font-weight:500;}
.c-devrow span{display:block;margin-top:3px;font-size:11px;color:#8C8676;}
.c-devrow i{font-style:normal;font-size:11px;color:#A9512F;flex:none;}
.c-kv{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-top:1px solid #EFE7D7;font-size:12px;}
.c-kv:first-of-type{border-top:none;}
.c-kv span:first-child{color:#8C8676;}
.c-mono{font-family:Menlo,monospace;font-size:9.5px;}
.c-card p{margin:4px 0 0;font-size:11.5px;line-height:1.8;color:#6D6A5E;}
.c-log{margin-top:12px;text-align:center;font-size:10.5px;color:#A7A192;letter-spacing:.06em;}
.c-logout{margin:12px 0 20px;height:42px;border:1px solid #A9512F;border-radius:21px;color:#A9512F;display:flex;align-items:center;justify-content:center;font-size:12px;letter-spacing:.14em;}

/* panels */
.panel-body{background:#F4EFE3;}
.c-crop{padding:16px 18px;height:352px;}
.c-cal-head{display:flex;align-items:flex-start;justify-content:space-between;}
.c-cal-kicker{font-size:9.5px;letter-spacing:.16em;color:#9E9885;}
.c-cal-month{font-family:"Songti SC",serif;font-size:23px;font-weight:600;color:#1F2328;margin-top:2px;}
.c-cal-month em{font-style:normal;font-family:-apple-system,"PingFang SC",sans-serif;font-size:9px;font-weight:400;color:#8C8676;margin-left:6px;letter-spacing:.08em;}
.c-cal-nav{display:flex;align-items:center;gap:6px;}
.c-cal-nav span{width:28px;height:28px;border-radius:14px;border:1px solid #D8CEB8;display:flex;align-items:center;justify-content:center;font-size:15px;color:#615C50;}
.c-cal-nav span.today{width:auto;padding:0 10px;font-size:10px;color:#35485C;border-color:#B9C2CF;}
.c-cal-week{display:flex;margin-top:12px;}
.c-cal-week span{width:14.2857%;text-align:center;font-size:10px;color:#9E9885;}
.c-cal-grid{display:flex;flex-wrap:wrap;margin-top:4px;}
.c-cal-cell{width:14.2857%;height:38px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;}
.c-cal-d{width:28px;height:26px;display:flex;align-items:center;justify-content:center;font-family:"Songti SC",serif;font-size:12px;color:#1F2328;}
.c-cal-cell.we .c-cal-d{color:#8C8676;}
.c-cal-cell.out .c-cal-d{color:#CFC7B5;}
.c-cal-cell.today .c-cal-d{outline:1px solid #8FA0B2;outline-offset:0;border-radius:50%;color:#35485C;}
.c-cal-cell.sel .c-cal-d{background:#35485C;color:#F7F3E8;border-radius:50%;}
.c-cal-cell.sel .c-cal-dot{background:#F7F3E8;}
.c-cal-dot{width:3px;height:3px;border-radius:50%;background:#35485C;display:block;}
.c-cal-legend{display:flex;gap:14px;margin-top:10px;padding-top:8px;border-top:1px solid #E4DAC4;font-size:10px;color:#8C8676;}
.c-cal-legend span{display:flex;align-items:center;gap:4px;}
.c-cal-legend i{width:8px;height:8px;border:1px solid #8FA0B2;border-radius:50%;display:block;}
.c-cal-legend b{width:8px;height:8px;border-radius:50%;background:#35485C;display:block;}
.c-cal-legend em{width:3px;height:3px;border-radius:50%;background:#35485C;display:block;}
.c-cal-sum{display:flex;align-items:baseline;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid #E4DAC4;font-size:10px;color:#9E9885;}
.c-cal-sum b{font-size:12px;font-weight:500;color:#1F2328;}
.c-cal-sum em{margin-left:auto;font-style:normal;font-family:Menlo,monospace;font-size:10px;color:#615C50;}

.c-pair{position:relative;height:352px;background:#F4EFE3;overflow:hidden;}
.c-pair-dim{position:absolute;inset:0;background:rgba(31,35,40,.10);}
.c-modal{position:absolute;left:30px;right:30px;top:52px;background:#FCF9F1;border-radius:16px;overflow:hidden;box-shadow:0 18px 40px rgba(31,35,40,.16);}
.c-modal-strip{height:6px;background:#35485C;}
.c-modal-body{padding:20px 20px 18px;}
.c-modal-title{font-family:"Songti SC",serif;font-size:20px;font-weight:600;}
.c-modal-sub{margin-top:5px;font-size:10.5px;color:#8C8676;}
.c-modal-input{margin-top:14px;height:44px;border-radius:10px;background:#F2ECE0;border:1px solid #B9C2CF;display:flex;align-items:center;padding:0 12px;font-family:Menlo,monospace;font-size:14px;letter-spacing:.16em;color:#1F2328;}
.c-modal-hint{margin-top:6px;font-size:9px;color:#A7A192;}
.c-modal-actions{display:flex;gap:8px;margin-top:16px;}
.c-modal-actions span{flex:1;height:40px;border-radius:20px;border:1px solid #D8CEB8;display:flex;align-items:center;justify-content:center;font-size:12px;color:#615C50;}
.c-modal-actions span.ok{background:#35485C;border-color:#35485C;color:#F7F3E8;}

.c-colors{padding:16px 14px;height:352px;}
.c-colors-title{font-family:"Songti SC",serif;font-size:16px;font-weight:600;letter-spacing:.04em;}
.c-colors-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 8px;margin-top:12px;}
.c-swatch{position:relative;display:flex;flex-direction:column;gap:2px;}
.c-swatch > span{height:34px;border-radius:4px;display:block;}
.c-swatch b{font-size:10px;font-weight:500;color:#3A3A34;}
.c-swatch i{font-style:normal;font-size:9px;color:#9E9885;}
.c-swatch.now > span{outline:2px solid #1F2328;outline-offset:2px;}
.c-swatch em{position:absolute;right:0;top:0;font-style:normal;font-size:7px;letter-spacing:.08em;color:#F7F3E8;background:#1F2328;padding:1px 3px;border-radius:2px;}
.c-colors-foot{margin-top:14px;padding-top:10px;border-top:1px solid #E4DAC4;font-size:9.5px;line-height:1.7;color:#8C8676;}

.c-share{position:absolute;}
.c-share-label-board{font-size:11px;letter-spacing:.12em;color:#9E9885;margin-bottom:10px;}
.c-share-art{width:220px;height:176px;background:#35485C;padding:16px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden;}
.c-share-art::after{content:"";position:absolute;right:-30px;top:-30px;width:120px;height:120px;border-radius:50%;background:rgba(247,243,232,.06);}
.c-share-sticker{width:40px;height:40px;background:#F7F3E8;border-radius:3px;display:flex;align-items:center;justify-content:center;}
.c-share-sticker img{width:30px;height:30px;display:block;}
.c-share-title{font-family:"Songti SC",serif;font-size:18px;font-weight:600;line-height:1.35;color:#F7F3E8;letter-spacing:.04em;}
.c-share-meta{display:flex;justify-content:space-between;font-size:8.5px;letter-spacing:.1em;color:rgba(247,243,232,.62);}
;
`;
