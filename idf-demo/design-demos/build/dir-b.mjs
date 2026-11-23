import { phone, slot, panel, shareCard, chat, board, frameCss } from './frame.mjs';

const events = [
  { t: '09:00', title: '周会', note: '5 楼小会议室' },
  { t: '14:00', title: '设计评审', note: '带上打印稿' },
  { t: '19:30', title: '英语听力', note: '第 4 单元' },
];

const dayBlock = (d, wd, count, list, today = false) => `
<div class="b-day ${today ? 'today' : ''}">
  <div class="b-rail"><span class="b-wd">${wd}</span><span class="b-num">${d}</span><span class="b-count">${count} 条</span></div>
  <div class="b-daybody">
    ${list.map((e) => `<div class="b-ev">
      <span class="b-time">${e.t}</span>
      <div class="b-ev-main"><b>${e.title}</b>${e.note ? `<span>${e.note}</span>` : ''}</div>
      <div class="b-ev-acts"><i>编辑</i><i class="del">删除</i></div>
    </div>`).join('')}
  </div>
</div>`;

const login = (logo) => phone({
  page: 'pages/login/login', nav: 'custom', inverted: true, screenClass: 'b-screen',
  content: `<div class="b-login">
    <div class="b-cover">
      <div class="b-label"><img src="${logo}" alt=""></div>
      <div class="b-cover-brand">墨程CalCal</div>
      <div class="b-cover-tag">把日程写进墨水屏</div>
    </div>
    <div class="b-sheet">
      <div class="b-sheet-title">登录后开始连接设备</div>
      <p class="b-sheet-copy">用微信身份识别你的账号，日程会同时保存在云端，没带设备也能看。</p>
      <div class="b-cta">微信一键登录</div>
      <p class="b-note">首次在真机上使用时，请允许微信访问蓝牙。登录状态保存在本机，可在「我的」中退出。</p>
      <div class="b-api">接口 calcal.acenova.tech</div>
    </div>
  </div>`,
});

const add = () => phone({
  page: 'pages/index/index', title: '墨程CalCal', tab: '添加', screenClass: 'b-screen',
  content: `<div class="b-add">
    <div class="b-add-head">
      <div>
        <div class="b-kicker">新日程 · 周二</div>
        <div class="b-add-date"><span class="b-big">24</span><span class="b-month">十一月<br>2026</span></div>
      </div>
      <div class="b-stamp">已连接</div>
    </div>

    <div class="b-device">
      <span class="b-dot"></span><b>墨程CalCal</b><span>固件 1.0.0 · 12 条</span>
      <i>同步</i><i>休眠</i><i class="del">断开</i>
    </div>

    <div class="b-voice">
      <div class="b-sec"><span>说一句</span><em>AI 填好，核对后保存</em></div>
      <p class="b-voice-text">明天下午三点项目评审，会议室 A，带上打印稿</p>
      <div class="b-hold">按住 说话</div>
      <div class="b-tape"><span>0</span><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><span>60 秒</span></div>
      <div class="b-parse">解析日程</div>
    </div>

    <div class="b-form">
      <div class="b-sec"><span>日程</span><em>已按语音填好</em></div>
      <div class="b-time-row"><span class="b-time-big">15:00</span><em>—</em><span class="b-time-big">16:00</span><span class="b-time-label">开始 / 结束</span></div>
      <div class="b-field"><span class="b-flabel">标题</span><span class="b-fvalue">项目评审</span><span class="b-count-b">12/95</span></div>
      <div class="b-field"><span class="b-flabel">备注</span><span class="b-fvalue">会议室 A · 带上打印稿</span><span class="b-count-b">30/191</span></div>
      <div class="b-save">保存日程</div>
    </div>

    <div class="b-log">查看蓝牙协议日志</div>
  </div>`,
});

const agenda = () => phone({
  page: 'pages/calendar/calendar', title: '墨程CalCal', tab: '日程', screenClass: 'b-screen',
  content: `<div class="b-ag">
    <div class="b-ag-head">
      <div class="b-ag-month">十一月<em>2026</em></div>
      <div class="b-ag-meta">6 条 · 已同步</div>
      <div class="b-ag-nav"><span>&lsaquo;</span><span>&rsaquo;</span></div>
    </div>
    <div class="b-rule-double"></div>
    ${dayBlock(23, '周一', 3, events, true)}
    ${dayBlock(24, '周二', 2, [
      { t: '10:00', title: '客户电话', note: '' },
      { t: '15:00', title: '项目评审', note: '会议室 A' },
    ])}
    ${dayBlock(26, '周四', 1, [{ t: '18:00', title: '牙医复诊', note: '口腔医院 3 楼' }])}
    <div class="b-ag-foot">本月共 6 条 · 云端已同步</div>
  </div>`,
});

const profile = () => phone({
  page: 'pages/profile/profile', title: '墨程CalCal', tab: '我的', screenClass: 'b-screen',
  content: `<div class="b-profile">
    <div class="b-brandline"><span class="b-brandname">墨程CalCal</span><span class="b-brandtag">墨水屏日程表</span></div>
    <div class="b-rule-double"></div>

    <div class="b-prow">
      <span class="b-avatar">林</span>
      <div><div class="b-name">林屿</div><div class="b-uid">用户 ID u_7f3a9c21</div></div>
      <span class="b-save-link">保存</span>
    </div>

    <div class="b-sec-title">我的设备</div>
    <div class="b-devrow">
      <div>
        <div class="b-devname">墨程CalCal <span class="b-stamp small">已绑定</span></div>
        <div class="b-devmeta">绑定于 2026-11-09 · 固件 1.0.0</div>
      </div>
      <i>解绑</i>
    </div>

    <div class="b-sec-title">关于本机</div>
    <div class="b-leader-row"><span>应用</span><i></i><span>墨程CalCal</span></div>
    <div class="b-leader-row"><span>接口</span><i></i><span class="b-mono">calcal.acenova.tech</span></div>
    <div class="b-leader-row"><span>客户端</span><i></i><span>体验版</span></div>
    <div class="b-leader-row"><span>设备协议</span><i></i><span>proto 3</span></div>

    <div class="b-sec-title">关于设备归属</div>
    <p class="b-note-text">登录用于账号身份识别和云端日程归属。日程保存在云端，连接设备后自动双向同步；设备端删除也会同步删除云端对应日程。</p>

    <div class="b-logout">退出登录</div>
    <div class="b-colophon">墨程CalCal · 墨水屏日程表 · proto 3</div>
  </div>`,
});

/* ---------------- panels ---------------- */

const weeks = ['日', '一', '二', '三', '四', '五', '六'];
const cells = [];
for (let i = 0; i < 35; i += 1) {
  const d = i + 1;
  if (d > 30) cells.push('<span class="b-cal-cell out"></span>');
  else cells.push(`<span class="b-cal-cell ${d === 24 ? 'sel' : d === 23 ? 'today' : ''} ${[0, 6].includes(i % 7) ? 'we' : ''}"><span>${d}</span></span>`);
}

const calendarCrop = () => `<div class="b-crop">
  <div class="b-crop-head"><span class="b-kicker">日期</span><span class="b-crop-value">11月24日 周二</span></div>
  <div class="b-cal">
    <div class="b-cal-head"><span>&lsaquo;</span><b>2026 年 11 月</b><span>&rsaquo;</span><em>今天</em></div>
    <div class="b-cal-week">${weeks.map((w) => `<span>${w}</span>`).join('')}</div>
    <div class="b-cal-grid">${cells.join('')}</div>
  </div>
  <div class="b-crop-time"><span>15:00</span><em>—</em><span>16:00</span><i>开始 / 结束</i></div>
</div>`;

const pairingCrop = () => `<div class="b-pair">
  <div class="b-slip">
    <div class="b-perf"></div>
    <div class="b-slip-title">设备配对</div>
    <div class="b-slip-sub">输入设备屏幕上的 12 位配对码</div>
    <div class="b-slip-label">配对码</div>
    <div class="b-slip-input">K7Q4 M2X9 B3TF</div>
    <div class="b-slip-hint">不区分大小写，例如 K7Q4M2X9B3TF</div>
    <div class="b-slip-actions"><span>取消</span><span class="ok">配对</span></div>
    <div class="b-perf"></div>
  </div>
</div>`;

const spec = () => `<div class="b-spec">
  <div class="b-spec-title">日记页的构成</div>
  <div class="b-spec-diagram">
    <div class="b-spec-rail"><span>24</span><em>周二</em></div>
    <div class="b-spec-body">
      <div class="b-spec-line"><i></i></div>
      <div class="b-spec-line"><i style="width:72%"></i></div>
      <div class="b-spec-line"><i style="width:54%"></i></div>
    </div>
    <span class="b-spec-w">56</span><span class="b-spec-w body">323</span>
  </div>
  <div class="b-spec-type">
    <div><b class="b-t1">24</b><span>日期 / 宋体 34</span></div>
    <div><b class="b-t2">项目评审</b><span>标题 / 苹方 14</span></div>
    <div><b class="b-t3">会议室 A</b><span>备注 / 苹方 12</span></div>
  </div>
  <div class="b-spec-hair"></div>
  <div class="b-spec-colors">
    <span style="background:#F6F0E3"></span><span style="background:#1C2C4C"></span><span style="background:#201D17"></span><span style="background:#D8CEB8"></span>
  </div>
  <div class="b-spec-caps">纸 / 藏青 / 墨 / 线 · 双线 1px + 3px</div>
</div>`;

const shareArt = (logo) => `<div class="b-share-art">
  <div class="b-share-label"><img src="${logo}" alt=""></div>
  <div class="b-share-title">把日程<br>写进墨水屏</div>
  <div class="b-share-meta">墨程CalCal · 十一月</div>
</div>`;

export function dirB(logo) {
  const body = `
  ${slot({ x: 56, y: 396, scale: 0.76, label: '登录', note: '封面 + 纸页', node: login(logo) })}
  ${slot({ x: 378, y: 332, scale: 0.86, label: '添加', note: '一页填写 · 录音带刻度', node: add() })}
  ${slot({ x: 724, y: 404, scale: 0.76, label: '日程', note: '日期栏贯穿每天', node: agenda() })}
  ${slot({ x: 1046, y: 364, scale: 0.78, label: '我的', note: '版权页式的信息表', node: profile() })}
  ${panel({ x: 56, y: 1120, w: 375, h: 380, label: '日期选择 · 1:1', note: '账本格 · 宋体数字', node: calendarCrop() })}
  ${panel({ x: 463, y: 1120, w: 375, h: 380, label: '配对 · 1:1', note: '一张带骑缝线的回执', node: pairingCrop() })}
  ${panel({ x: 870, y: 1120, w: 300, h: 380, label: '日期栏', note: '56 / 323', node: spec() })}
  <div class="b-share" style="left:1176px;top:1096px">
    <div class="b-share-label-board">转发卡片 · 5:4</div>
    ${chat({ children: shareCard({ title: '把日程写进墨水屏', artwork: shareArt(logo), icon: `<img src="${logo}" alt="">` }) })}
  </div>`;

  const html = board({
    title: '日程簿',
    kicker: '方向二 · 现实参照｜Timepage',
    lede: '一台挂在墙上的墨水屏日程表，手机端就是它的填写页：左边一栏写日期，右边一栏写事，中间只用一条线。',
    meta: '<b>form 来自</b> 账本的日期栏与双线 · <b>主入口</b> 扫码进来先看今天 · <b>借的</b> 日期是一条竖栏，不是表格',
    body,
    cls: 'b-board',
  });
  return html.replace('__CSS__', frameCss + css);
}

const css = `
.b-board .board{height:1520px;}
.b-board{--paper:#F6F0E3;--ink:#201D17;--muted:#9AA3B6;--faint:#7C879C;--navy:#1C2C4C;
  --nav-bg:#F6F0E3;--nav-fg:#201D17;--tab-bg:#F6F0E3;--tab-on:#1C2C4C;--tab-dim:#B7AC95;--tab-border:#E1D7C2;
  --fg:#F1EADA;--label:#E9E1CF;--label-dim:#9AA3B6;
  background:#1C2C4C;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#F1EADA;}
.b-board .board-kicker{color:#93A0B8;}
.b-board .board-head h1{font-family:"Songti SC","Noto Serif SC",serif;font-size:68px;font-weight:600;color:#F5EFDF;letter-spacing:.04em;line-height:1.1;}
.b-board .board-lede{color:#C4CCDB;font-size:15px;max-width:560px;}
.b-board .board-meta{color:#8E9AB0;}
.b-board .board-meta b{color:#C4CCDB;}

.b-screen{--paper:#F6F0E3;}
.b-screen .nav-title{letter-spacing:.02em;}
.b-label{width:96px;height:96px;background:#F6F0E3;border-radius:3px;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 0 rgba(0,0,0,.18);}
.b-label img{width:72px;height:72px;display:block;}
.b-login{height:100%;display:flex;flex-direction:column;background:#1C2C4C;}
.b-cover{height:440px;padding:118px 32px 0;background:
  linear-gradient(180deg,rgba(255,255,255,.03),rgba(0,0,0,.10)),#1C2C4C;position:relative;}
.b-cover::after{content:"";position:absolute;left:32px;right:32px;bottom:0;height:1px;background:rgba(246,240,227,.22);}
.b-cover-brand{margin-top:26px;font-size:30px;font-weight:500;color:#F6F0E3;letter-spacing:.03em;}
.b-cover-tag{margin-top:8px;font-size:12px;letter-spacing:.26em;color:rgba(246,240,227,.6);}
.b-sheet{flex:1;background:#F6F0E3;color:#201D17;padding:30px 32px 24px;position:relative;}
.b-sheet::before{content:"";position:absolute;left:32px;right:32px;top:12px;height:4px;border-top:1px solid #201D17;border-bottom:1px solid #201D17;}
.b-sheet-title{font-family:"Songti SC",serif;font-size:21px;font-weight:600;letter-spacing:.02em;}
.b-sheet-copy{margin:10px 0 22px;font-size:13px;line-height:1.85;color:#5F594B;}
.b-cta{height:52px;background:#1C2C4C;color:#F6F0E3;font-size:15px;letter-spacing:.1em;display:flex;align-items:center;justify-content:center;border-radius:3px;box-shadow:0 3px 0 #0E1830;}
.b-note{margin:16px 0 0;font-size:12px;line-height:1.8;color:#857C69;}
.b-api{margin-top:18px;text-align:center;font-size:10.5px;color:#A79D88;letter-spacing:.02em;}

.b-add{padding:18px 26px 20px;}
.b-kicker{font-size:12px;letter-spacing:.14em;color:#8B7F68;}
.b-add-head{display:flex;align-items:flex-start;justify-content:space-between;}
.b-add-date{display:flex;align-items:flex-end;gap:10px;margin-top:2px;}
.b-big{font-family:"Songti SC",serif;font-size:56px;font-weight:600;line-height:.86;letter-spacing:0;color:#201D17;}
.b-month{font-size:11px;line-height:1.5;color:#8B7F68;padding-bottom:4px;letter-spacing:.04em;}
.b-stamp{font-size:11.5px;letter-spacing:.12em;color:#1C2C4C;border:1px solid #1C2C4C;padding:5px 8px;border-radius:2px;transform:rotate(-1.5deg);background:rgba(28,44,76,.03);}
.b-stamp.small{font-size:9.5px;padding:2px 5px;transform:none;margin-left:4px;letter-spacing:.08em;vertical-align:1px;}
.b-device{display:flex;align-items:center;gap:8px;height:42px;margin-top:12px;border-top:1px solid #201D17;border-bottom:1px solid #201D17;font-size:11px;color:#5F594B;}
.b-dot{width:6px;height:6px;border-radius:50%;background:#2C8A6F;flex:none;}
.b-device b{font-size:12px;font-weight:600;color:#201D17;}
.b-device span{color:#8B7F68;}
.b-device i{margin-left:auto;font-style:normal;font-size:12px;color:#4E4A40;}
.b-device i + i{margin-left:12px;}
.b-device i.del{color:#9C3427;}
.b-voice{margin-top:16px;}
.b-sec{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid #201D17;padding-bottom:7px;}
.b-sec span{font-family:"Songti SC",serif;font-size:15px;font-weight:600;letter-spacing:.06em;}
.b-sec em{font-style:normal;font-size:11.5px;color:#8B7F68;}
.b-voice-text{margin:10px 0 0;font-size:14px;line-height:1.7;color:#201D17;}
.b-hold{height:44px;border:1px solid #1C2C4C;border-bottom-width:3px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:13px;letter-spacing:.1em;color:#1C2C4C;margin-top:12px;background:#FBF7EC;}
.b-tape{display:flex;align-items:center;gap:2px;margin-top:6px;height:12px;}
.b-tape span{font-size:10px;color:#A49A85;font-feature-settings:"tnum";}
.b-tape i{flex:1;height:5px;border-left:1px solid #C9BFA8;display:block;}
.b-tape i:nth-child(5n){height:8px;border-color:#9E937C;}
.b-parse{text-align:right;margin-top:6px;font-size:12px;color:#1C2C4C;text-decoration:underline;text-underline-offset:3px;}
.b-form{margin-top:16px;}
.b-time-row{display:flex;align-items:baseline;gap:8px;margin-top:8px;padding-bottom:6px;border-bottom:1px solid #211E18;}
.b-time-big{font-family:"Songti SC",serif;font-size:25px;font-weight:600;letter-spacing:.02em;color:#201D17;}
.b-time-row em{font-style:normal;color:#8B7F68;font-size:13px;}
.b-time-label{margin-left:auto;font-size:10px;color:#9A8F79;}
.b-field{display:flex;align-items:baseline;gap:10px;height:38px;border-bottom:1px solid #DFD5C0;}
.b-flabel{width:34px;flex:none;font-size:11px;color:#9A8F79;}
.b-fvalue{font-size:14px;color:#201D17;}
.b-count-b{margin-left:auto;font-size:10px;color:#B3A992;font-feature-settings:"tnum";}
.b-save{margin-top:18px;height:50px;border-radius:3px;background:#1C2C4C;color:#F6F0E3;font-size:15px;letter-spacing:.14em;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 0 #0E1830;}
.b-log{margin-top:14px;text-align:center;font-size:10.5px;color:#A79D88;letter-spacing:.06em;}

.b-ag{padding:16px 0 20px;}
.b-ag-head{padding:0 26px;display:flex;align-items:flex-end;justify-content:space-between;}
.b-ag-month{font-family:"Songti SC",serif;font-size:30px;font-weight:600;color:#201D17;letter-spacing:.02em;}
.b-ag-month em{font-style:normal;font-family:-apple-system,"PingFang SC",sans-serif;font-size:10px;font-weight:400;color:#8B7F68;margin-left:8px;letter-spacing:.08em;}
.b-ag-meta{font-size:12px;color:#8B7F68;padding-bottom:4px;}
.b-ag-nav{display:flex;gap:10px;padding-bottom:2px;}
.b-ag-nav span{width:30px;height:30px;display:flex;align-items:center;justify-content:center;border:1px solid #C9BFA8;border-radius:2px;font-size:16px;color:#5F594B;}
.b-rule-double{margin:10px 26px 0;height:4px;border-top:1px solid #201D17;border-bottom:1px solid #201D17;}
.b-day{display:flex;margin-top:16px;min-height:96px;}
.b-rail{width:56px;flex:none;padding:8px 0 8px 26px;display:flex;flex-direction:column;align-items:flex-start;gap:2px;box-sizing:border-box;}
.b-wd{font-size:10px;color:#8B7F68;letter-spacing:.06em;}
.b-num{font-family:"Songti SC",serif;font-size:31px;font-weight:600;line-height:1;color:#201D17;}
.b-count{font-size:10.5px;color:#A79D88;margin-top:2px;}
.b-daybody{flex:1;min-width:0;border-left:1px solid #D8CEB8;padding:2px 26px 2px 12px;}
.b-day.today .b-rail{padding-left:10px;margin-left:16px;background:#1C2C4C;border-radius:3px 0 0 3px;color:#F6F0E3;}
.b-day.today .b-wd{color:rgba(246,240,227,.66);}
.b-day.today .b-num{color:#F6F0E3;}
.b-day.today .b-count{color:rgba(246,240,227,.55);}
.b-day.today .b-daybody{border-left-color:#1C2C4C;padding-left:12px;}
.b-ev{display:flex;align-items:flex-start;gap:8px;padding:9px 0;border-bottom:1px solid #E4DAC5;}
.b-ev:last-child{border-bottom:none;}
.b-time{width:40px;flex:none;font-size:12px;color:#6D6453;font-feature-settings:"tnum";padding-top:2px;}
.b-ev-main{flex:1;min-width:0;}
.b-ev-main b{display:block;font-size:14px;font-weight:500;color:#201D17;line-height:1.35;}
.b-ev-main span{display:block;margin-top:2px;font-size:11.5px;color:#8B7F68;line-height:1.4;}
.b-ev-acts{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:3px;}
.b-ev-acts i{font-style:normal;font-size:12px;color:#8B7F68;}
.b-ev-acts i.del{color:#9C3427;}
.b-ag-foot{margin:20px 26px 0;padding-top:10px;border-top:1px solid #D8CEB8;font-size:10px;color:#A79D88;text-align:center;letter-spacing:.04em;}

.b-profile{padding:14px 26px 20px;display:flex;flex-direction:column;min-height:100%;}
.b-brandline{display:flex;align-items:baseline;justify-content:space-between;}
.b-brandname{font-family:"Songti SC",serif;font-size:22px;font-weight:600;letter-spacing:.03em;}
.b-brandtag{font-size:10px;letter-spacing:.18em;color:#8B7F68;}
.b-prow{display:flex;align-items:center;gap:14px;padding:12px 0 10px;border-bottom:1px solid #201D17;}
.b-avatar{width:52px;height:52px;border-radius:50%;background:#E8DFC9;display:flex;align-items:center;justify-content:center;font-family:"Songti SC",serif;font-size:19px;color:#4E4A40;flex:none;}
.b-name{font-size:19px;font-weight:600;}
.b-uid{margin-top:3px;font-size:11px;color:#9A8F79;}
.b-save-link{margin-left:auto;font-size:11px;color:#1C2C4C;text-decoration:underline;text-underline-offset:3px;}
.b-sec-title{margin-top:14px;padding-bottom:5px;border-bottom:1px solid #D8CEB8;font-size:11px;letter-spacing:.16em;color:#8B7F68;}
.b-devrow{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:9px 0;}
.b-devname{font-size:13px;font-weight:600;}
.b-devmeta{margin-top:5px;font-size:11px;color:#9A8F79;}
.b-devrow > i{font-style:normal;font-size:11px;color:#9C3427;flex:none;}
.b-leader-row{display:flex;align-items:baseline;font-size:12px;color:#201D17;padding:5px 0;}
.b-leader-row span:first-child{color:#8B7F68;flex:none;}
.b-leader-row i{flex:1;border-bottom:1px dotted #C1B69E;margin:0 8px 3px;}
.b-leader-row span:last-child{flex:none;max-width:170px;text-align:right;}
.b-mono{font-family:Menlo,monospace;font-size:10px;}
.b-note-text{margin:8px 0 0;font-size:11.5px;line-height:1.7;color:#6D6453;}
.b-logout{margin-top:auto;height:40px;border:1px solid #9C3427;color:#9C3427;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:12px;letter-spacing:.14em;}
.b-colophon{margin-top:12px;padding-top:10px;border-top:1px solid #E7DDC8;text-align:center;font-size:10px;letter-spacing:.1em;color:#A79D88;}

/* panels */
.panel-body{background:#F6F0E3;}
.b-crop{padding:16px 22px;height:380px;}
.b-crop-head{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid #201D17;padding-bottom:8px;}
.b-crop-value{font-size:13px;color:#201D17;}
.b-cal{margin-top:12px;}
.b-cal-head{display:flex;align-items:center;gap:8px;}
.b-cal-head span{width:26px;height:26px;display:flex;align-items:center;justify-content:center;color:#5F594B;font-size:15px;}
.b-cal-head b{flex:1;text-align:center;font-family:"Songti SC",serif;font-size:14px;font-weight:600;}
.b-cal-head em{font-style:normal;font-size:10px;color:#1C2C4C;border:1px solid #A9B4C8;padding:3px 7px;border-radius:2px;}
.b-cal-week{display:flex;margin-top:6px;}
.b-cal-week span{width:14.2857%;text-align:center;font-size:10px;color:#9A8F79;}
.b-cal-grid{display:flex;flex-wrap:wrap;margin-top:2px;border-top:1px solid #E4DAC5;border-left:1px solid #E4DAC5;}
.b-cal-cell{width:14.2857%;height:33px;display:flex;align-items:center;justify-content:center;border-right:1px solid #EDE4D1;border-bottom:1px solid #EDE4D1;box-sizing:border-box;}
.b-cal-cell span{width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-family:"Songti SC",serif;font-size:12px;color:#201D17;}
.b-cal-cell.we{background:#F1E9D8;}
.b-cal-cell.out span{color:#C9BFA8;}
.b-cal-cell.today span{outline:1px solid #8FA0BB;outline-offset:-2px;color:#1C2C4C;}
.b-cal-cell.sel span{background:#1C2C4C;color:#F6F0E3;}
.b-crop-time{display:flex;align-items:baseline;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid #201D17;}
.b-crop-time span{font-family:"Songti SC",serif;font-size:22px;font-weight:600;}
.b-crop-time em{font-style:normal;color:#8B7F68;}
.b-crop-time i{margin-left:auto;font-style:normal;font-size:10px;color:#9A8F79;}

.b-pair{height:380px;background:#1C2C4C;display:flex;align-items:center;justify-content:center;padding:22px;}
.b-slip{width:100%;background:#F6F0E3;border-radius:3px;padding:18px 18px 12px;position:relative;box-shadow:0 10px 30px rgba(0,0,0,.28);}
.b-perf{height:1px;border-top:1px dashed #A89D86;margin:0 -18px 12px;}
.b-slip > .b-perf:last-child{margin:12px -18px 0;}
.b-slip-title{font-family:"Songti SC",serif;font-size:20px;font-weight:600;letter-spacing:.06em;}
.b-slip-sub{margin-top:5px;font-size:11px;color:#8B7F68;}
.b-slip-label{margin-top:14px;font-size:10px;letter-spacing:.16em;color:#9A8F79;}
.b-slip-input{margin-top:6px;height:42px;border-bottom:1px solid #1C2C4C;font-family:Menlo,monospace;font-size:14px;letter-spacing:.18em;display:flex;align-items:center;color:#201D17;}
.b-slip-hint{margin-top:6px;font-size:10px;color:#9A8F79;}
.b-slip-actions{display:flex;gap:8px;margin-top:14px;}
.b-slip-actions span{flex:1;height:38px;border:1px solid #C9BFA8;border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#5F594B;}
.b-slip-actions span.ok{background:#1C2C4C;border-color:#1C2C4C;color:#F6F0E3;}

.b-spec{padding:18px;height:380px;}
.b-spec-title{font-family:"Songti SC",serif;font-size:17px;font-weight:600;letter-spacing:.04em;}
.b-spec-diagram{position:relative;display:flex;height:118px;margin-top:14px;border:1px solid #C9BFA8;}
.b-spec-rail{width:56px;background:#1C2C4C;color:#F6F0E3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;}
.b-spec-rail span{font-family:"Songti SC",serif;font-size:26px;font-weight:600;line-height:1;}
.b-spec-rail em{font-style:normal;font-size:8px;letter-spacing:.1em;color:rgba(246,240,227,.7);}
.b-spec-body{flex:1;padding:14px 12px;display:flex;flex-direction:column;gap:12px;justify-content:center;}
.b-spec-line{height:10px;background:#E9E0CC;border-radius:2px;}
.b-spec-line i{display:block;height:100%;width:88%;background:#C9BFA8;border-radius:2px;}
.b-spec-w{position:absolute;left:0;bottom:-16px;font-size:9px;color:#9A8F79;letter-spacing:.08em;}
.b-spec-w.body{left:56px;}
.b-spec-type{margin-top:30px;display:flex;flex-direction:column;gap:10px;}
.b-spec-type div{display:flex;align-items:baseline;gap:10px;}
.b-spec-type span{font-size:10px;color:#9A8F79;}
.b-t1{font-family:"Songti SC",serif;font-size:26px;line-height:1;}
.b-t2{font-size:14px;font-weight:500;}
.b-t3{font-size:12px;color:#5F594B;}
.b-spec-hair{height:1px;background:#201D17;margin-top:16px;}
.b-spec-colors{display:flex;height:26px;margin-top:10px;border:1px solid #C9BFA8;}
.b-spec-colors span{flex:1;}
.b-spec-caps{margin-top:10px;font-size:9.5px;color:#9A8F79;letter-spacing:.04em;line-height:1.6;}

.b-share{position:absolute;}
.b-share-label-board{font-size:11px;letter-spacing:.12em;color:#93A0B8;margin-bottom:10px;}
.b-share-art{width:220px;height:176px;background:#1C2C4C;padding:16px;display:flex;flex-direction:column;justify-content:space-between;}
.b-share-label{width:44px;height:44px;background:#F6F0E3;border-radius:2px;display:flex;align-items:center;justify-content:center;}
.b-share-label img{width:32px;height:32px;display:block;}
.b-share-title{font-family:"Songti SC",serif;font-size:19px;font-weight:600;line-height:1.35;color:#F6F0E3;letter-spacing:.03em;}
.b-share-meta{font-size:9px;letter-spacing:.14em;color:rgba(246,240,227,.58);}
;
`;
