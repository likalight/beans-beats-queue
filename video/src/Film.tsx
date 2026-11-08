import React from 'react';
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { CLIPS } from './clips';
import { TIMELINE, TOTAL } from './timeline';

export { TOTAL };
const ORANGE = '#fa6105', ORANGE_L = '#ff8a3d', INK = '#141212', CREAM = '#f5f0eb', MUTE = '#a39c96';
const FONT = '"Alte Haas Grotesk", "Helvetica Neue", Helvetica, Arial, sans-serif';

const fontCss = `
@font-face { font-family: "Alte Haas Grotesk"; src: url("${staticFile('AlteHaasGroteskRegular.woff2')}") format("woff2"); font-weight: 400; }
@font-face { font-family: "Alte Haas Grotesk"; src: url("${staticFile('AlteHaasGroteskBold.woff2')}") format("woff2"); font-weight: 700; }`;

const ease = Easing.bezier(0.16, 1, 0.3, 1);
const fadeIn = (f: number, start: number, len = 14) => interpolate(f, [start, start + len], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
const rise = (f: number, start: number, len = 18, d = 40) => interpolate(f, [start, start + len], [d, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });

// Background: dark stage, warm glow, drifting snow and a soft equaliser.
const Stage: React.FC<{ beat?: boolean }> = ({ beat = true }) => {
  const f = useCurrentFrame();
  const kick = beat ? Math.exp(-((f % 15) / 15) * 5) : 0; // 120 BPM at 30 fps
  const flakes = React.useMemo(() => Array.from({ length: 90 }, (_, i) => ({ x: (i * 211) % 1920, y: (i * 137) % 1080, r: 1 + (i % 4) * 0.7, s: 0.6 + (i % 5) * 0.35 })), []);
  return (
    <AbsoluteFill style={{ background: INK, overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 80% 15%, rgba(250,97,5,${0.28 + kick * 0.1}), rgba(250,97,5,0) 60%)` }} />
      <AbsoluteFill style={{ background: 'radial-gradient(circle at 10% 100%, rgba(255,255,255,0.06), rgba(255,255,255,0) 50%)' }} />
      <svg width={1920} height={1080} style={{ position: 'absolute' }}>
        {flakes.map((p, i) => <circle key={i} cx={(p.x + Math.sin((f + i * 20) / 40) * 12) % 1920} cy={(p.y + f * p.s) % 1100} r={p.r} fill="#fff" opacity={0.35} />)}
        {Array.from({ length: 48 }, (_, i) => {
          const v = 0.25 + 0.25 * Math.sin(f / 9 + i * 0.5) * Math.sin(f / 23 + i * 0.13) + kick * 0.5 * Math.exp(-i / 10);
          const h = Math.max(4, v * v * 180);
          return <g key={i} fill={ORANGE} opacity={0.22}><rect x={960 + i * 20} y={1080 - h} width={11} height={h} /><rect x={949 - i * 20} y={1080 - h} width={11} height={h} /></g>;
        })}
      </svg>
    </AbsoluteFill>
  );
};

const Chapter: React.FC<{ n: string; title: string; start?: number }> = ({ n, title, start = 0 }) => {
  const f = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', left: 90, top: 70, display: 'flex', alignItems: 'baseline', gap: 22, opacity: fadeIn(f, start), transform: `translateY(${rise(f, start, 18, 20)}px)` }}>
      <span style={{ fontFamily: FONT, fontSize: 30, fontWeight: 700, color: ORANGE }}>{n}</span>
      <span style={{ fontFamily: FONT, fontSize: 54, fontWeight: 700, color: CREAM, letterSpacing: -1.5 }}>{title}</span>
    </div>
  );
};

// Guided caption list: each line lights up at its frame.
const Steps: React.FC<{ items: [number, string][]; left: number; top: number; width: number; size?: number }> = ({ items, left, top, width, size = 40 }) => {
  const f = useCurrentFrame();
  const active = items.reduce((a, [at], i) => (f >= at ? i : a), -1);
  return (
    <div style={{ position: 'absolute', left, top, width, display: 'grid', gap: 26 }}>
      {items.map(([at, text], i) => (
        <div key={i} style={{ display: 'flex', gap: 18, alignItems: 'flex-start', opacity: fadeIn(f, at) * (i === active ? 1 : 0.42), transform: `translateX(${rise(f, at, 18, -30)}px)` }}>
          <span style={{ flex: 'none', width: 14, height: 14, borderRadius: 99, marginTop: size * 0.35, background: i === active ? ORANGE : '#5a524d', boxShadow: i === active ? `0 0 24px ${ORANGE}` : 'none' }} />
          <span style={{ fontFamily: FONT, fontSize: size, fontWeight: 700, color: CREAM, lineHeight: 1.18, letterSpacing: -0.6 }}>{text}</span>
        </div>
      ))}
    </div>
  );
};

// A screen in a soft frame with a slow push-in.
const Screen: React.FC<{ src: string; x: number; y: number; w: number; h: number; dur: number; zoom?: [number, number]; origin?: string; radius?: number }> = ({ src, x, y, w, h, dur, zoom = [1, 1.06], origin = '50% 50%', radius = 22 }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 18, mass: 0.7 } });
  const z = interpolate(f, [0, dur], zoom, { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: radius, overflow: 'hidden', boxShadow: '0 40px 120px -30px rgba(250,97,5,0.45), 0 0 0 2px #2c2624', transform: `translateY(${(1 - s) * 80}px) scale(${0.94 + s * 0.06})`, opacity: s }}>
      <div style={{ width: '100%', height: '100%', transform: `scale(${z})`, transformOrigin: origin }}>
        <OffthreadVideo src={staticFile('clips/' + src)} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    </div>
  );
};

const Phone: React.FC<{ src?: string; img?: string; x: number; y: number; h: number }> = ({ src, img, x, y, h }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 16 } });
  const w = h * (src ? 430 / 932 : 1080 / 1920);
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w + 28, height: h + 28, padding: 14, borderRadius: 64, background: '#2a2523', boxShadow: '0 50px 140px -30px rgba(250,97,5,0.6), inset 0 0 0 2px #3d3633', transform: `translateY(${(1 - s) * 120}px) rotate(${(1 - s) * -4}deg)`, opacity: s }}>
      <div style={{ width: w, height: h, borderRadius: 50, overflow: 'hidden', background: src ? "#fff" : "#fa6105" }}>
        {src ? <OffthreadVideo src={staticFile('clips/' + src)} muted style={{ width: '100%', height: '100%' }} /> : <Img src={staticFile(img!)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </div>
    </div>
  );
};

const Intro: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const logo = spring({ frame: f - 6, fps, config: { damping: 14 } });
  const l1 = spring({ frame: f - 30, fps, config: { damping: 15 } });
  const l2 = spring({ frame: f - 44, fps, config: { damping: 15 } });
  return (
    <AbsoluteFill>
      <Stage />
      <Img src={staticFile('logo-white.png')} style={{ position: 'absolute', left: 120, top: 120, height: 190, opacity: logo, transform: `scale(${0.7 + logo * 0.3})`, transformOrigin: 'left top' }} />
      <div style={{ position: 'absolute', left: 116, top: 470, fontFamily: FONT, fontWeight: 700, fontSize: 168, lineHeight: 0.92, letterSpacing: -7, color: CREAM }}>
        <div style={{ transform: `translateY(${(1 - l1) * 120}px)`, opacity: l1 }}>Keep the queue</div>
        <div style={{ transform: `translateY(${(1 - l2) * 120}px)`, opacity: l2, color: ORANGE }}>on the beat.</div>
      </div>
      <div style={{ position: 'absolute', left: 124, top: 830, fontFamily: FONT, fontSize: 36, color: MUTE, opacity: fadeIn(f, 70) }}>
        The queue system for beans&amp;beats × Christmas Together 2026
      </div>
    </AbsoluteFill>
  );
};

const Problem: React.FC = () => {
  const f = useCurrentFrame();
  const lines: [number, string, string?][] = [[6, 'Hundreds of guests. One coffee bar.'], [40, 'Hall wifi that drops.'], [74, 'No app. No paper receipts. PDPA.'], [118, 'So we built a queue that moves with the music.', ORANGE]];
  return (
    <AbsoluteFill>
      <Stage />
      <div style={{ position: 'absolute', left: 120, top: 250, display: 'grid', gap: 30 }}>
        {lines.map(([at, t, c], i) => (
          <div key={i} style={{ fontFamily: FONT, fontWeight: 700, fontSize: i === 3 ? 84 : 72, letterSpacing: -2.5, color: c || CREAM, opacity: fadeIn(f, at) * (i < 3 && f > 118 ? 0.35 : 1), transform: `translateY(${rise(f, at)}px)`, marginTop: i === 3 ? 40 : 0 }}>{t}</div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const StoryCard: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Stage />
      <Chapter n="✦" title="Every cup becomes a story" />
      <Phone img="story-card.png" x={1140} y={150} h={800} />
      <Steps left={110} top={330} width={960} size={46} items={[[10, 'After pickup, one tap makes an "I sipped for Young Hearts" card.'], [55, 'Shared straight to Instagram from the phone.'], [100, 'Free reach for beans&beats and the cause.']]} />
      <div style={{ position: 'absolute', left: 110, top: 860, fontFamily: FONT, fontSize: 30, color: MUTE, opacity: fadeIn(f, 120) }}>A charity meter on the board and every phone counts the dollars raised live.</div>
    </AbsoluteFill>
  );
};

const Facts: React.FC = () => {
  const f = useCurrentFrame();
  const cards: [string, string][] = [['Works offline', 'Every tap saved on the device first. Syncs itself when wifi returns.'], ['No app', 'Guests scan a QR. Staff use any browser, tablet or laptop.'], ['PDPA by design', 'First name only. Mobile optional, deleted at pickup. Names wiped at close.'], ['POS stays in charge', 'Operator keys the total. CSV per order reconciles the day.'], ['One shared brain', 'The same reducer runs on the server and every device. No conflicts.'], ['Built for the vibe', 'Beat-reactive board, voice call-outs, beans&beats brand.']];
  return (
    <AbsoluteFill>
      <Stage />
      <div style={{ position: 'absolute', left: 110, top: 90, fontFamily: FONT, fontWeight: 700, fontSize: 64, color: CREAM, letterSpacing: -2, opacity: fadeIn(f, 0) }}>Built for a real booth on a real event day.</div>
      <div style={{ position: 'absolute', left: 110, top: 240, width: 1700, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 28 }}>
        {cards.map(([t, d], i) => (
          <div key={i} style={{ background: i === 0 ? ORANGE : '#1f1b1a', borderRadius: 28, padding: '34px 34px 40px', minHeight: 300, opacity: fadeIn(f, 10 + i * 9), transform: `translateY(${rise(f, 10 + i * 9, 20, 60)}px)`, boxShadow: '0 0 0 2px #2c2624' }}>
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 44, color: '#fff', letterSpacing: -1 }}>{t}</div>
            <div style={{ fontFamily: FONT, fontSize: 30, color: i === 0 ? '#ffe3d1' : MUTE, marginTop: 18, lineHeight: 1.3 }}>{d}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = spring({ frame: f - 4, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill>
      <Stage />
      <AbsoluteFill style={{ display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <Img src={staticFile('logo-white.png')} style={{ height: 230, opacity: s, transform: `scale(${0.8 + s * 0.2})` }} />
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 70, color: CREAM, letterSpacing: -2, marginTop: 40, opacity: fadeIn(f, 20) }}>Every cup → <span style={{ color: ORANGE }}>Singapore Red Cross Young Hearts</span></div>
          <div style={{ fontFamily: FONT, fontSize: 38, color: CREAM, marginTop: 44, opacity: fadeIn(f, 40) }}>Try it live: <b style={{ color: ORANGE_L }}>beans-beats-queue.onrender.com/demo</b></div>
          <div style={{ fontFamily: FONT, fontSize: 30, color: MUTE, marginTop: 16, opacity: fadeIn(f, 52) }}>github.com/likalight/beans-beats-queue · barista 1111 · booth lead 9999</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// Bottom caption bar used over full-screen clips.
const Caption: React.FC<{ items: [number, string][] }> = ({ items }) => {
  const f = useCurrentFrame();
  const cur = items.reduce((a, it) => (f >= it[0] ? it : a), items[0]);
  const local = f - cur[0];
  return (
    <div style={{ position: 'absolute', left: '50%', bottom: 56, transform: `translateX(-50%) translateY(${rise(local, 0, 14, 20)}px)`, opacity: fadeIn(local, 0, 10), background: 'rgba(20,18,18,0.92)', borderRadius: 999, padding: '22px 40px', fontFamily: FONT, fontWeight: 700, fontSize: 38, color: CREAM, whiteSpace: 'nowrap', boxShadow: `0 0 0 2px ${ORANGE}, 0 30px 80px -20px rgba(0,0,0,.8)` }}>
      {cur[1]}
    </div>
  );
};

export const Film: React.FC = () => {
  const T = TIMELINE;
  return (
    <AbsoluteFill style={{ background: INK }}>
      <style>{fontCss}</style>
      <Audio src={staticFile('soundtrack.wav')} />
      <Sequence from={T.board.from + T.callAt} durationInFrames={120}><Audio src={staticFile('callout.wav')} volume={1} /></Sequence>

      <Sequence from={T.intro.from} durationInFrames={T.intro.dur}><Intro /></Sequence>
      <Sequence from={T.problem.from} durationInFrames={T.problem.dur}><Problem /></Sequence>

      <Sequence from={T.order.from} durationInFrames={T.order.dur}>
        <Stage beat={false} />
        <Chapter n="01" title="Order at the counter" />
        <Screen src="order.mp4" x={90} y={180} w={1300} h={731} dur={T.order.dur} origin="70% 40%" />
        <Steps left={1450} top={230} width={420} size={36} items={[[20, 'Tap drinks. Hot or iced, milk or oat.'], [110, 'First name only.'], [170, 'Key the total on the POS, tap Paid · PayNow.'], [235, 'A QR appears. No receipt, no app.']]} />
      </Sequence>

      <Sequence from={T.guest.from} durationInFrames={T.guest.dur}>
        <Stage />
        <Chapter n="02" title="The guest follows along on their phone" />
        <Phone src="guest.mp4" x={1210} y={150} h={850} />
        <Steps left={110} top={300} width={1000} size={48} items={[[15, 'Scan the QR: a live page, no app.'], [75, 'The cup fills as the drink is made.'], [140, 'A live ETA from the bar\'s real pace.'], [215, 'Ready: chime, vibration, push alert, confetti.']]} />
      </Sequence>

      <Sequence from={T.queue.from} durationInFrames={T.queue.dur}>
        <Stage beat={false} />
        <Chapter n="03" title="The bar: one tap per step" />
        <Screen src="queue.mp4" x={90} y={180} w={1300} h={731} dur={T.queue.dur} origin="50% 20%" />
        <Steps left={1450} top={230} width={420} size={36} items={[[15, 'Up next → Making → Ready.'], [70, 'Live insights warn the lead before a rush or a stock-out.']]} />
      </Sequence>

      <Sequence from={T.board.from} durationInFrames={T.board.dur}>
        <AbsoluteFill><OffthreadVideo src={staticFile('clips/board.mp4')} muted /></AbsoluteFill>
        <Caption items={[[0, 'The TV board moves with the DJ: it listens and pulses on the beat'], [T.callAt - 10, 'New order? It fills the screen and is called out loud'], [T.callAt + 165, 'Charity milestones: confetti and a spoken thank-you']]} />
      </Sequence>

      <Sequence from={T.story.from} durationInFrames={T.story.dur}><StoryCard /></Sequence>

      <Sequence from={T.cockpit.from} durationInFrames={T.cockpit.dur}>
        <AbsoluteFill><OffthreadVideo src={staticFile('clips/cockpit.mp4')} muted /></AbsoluteFill>
        <Caption items={[[0, 'The whole booth on one screen: tablet, bar, board, guest phone'], [30, 'Rush hour: 12 guests arrive at once'], [CLIPS.cockpitWifiOff, 'The order tablet loses wifi… and keeps taking orders'], [CLIPS.cockpitWifiOn, 'Wifi back: everything syncs. No lost orders, no clashing numbers']]} />
      </Sequence>

      <Sequence from={T.report.from} durationInFrames={T.report.dur}>
        <Stage beat={false} />
        <Chapter n="04" title="Close the day" />
        <Screen src="report.mp4" x={90} y={180} w={1300} h={731} dur={T.report.dur} />
        <Steps left={1450} top={230} width={420} size={36} items={[[15, 'Sales, cups, PayNow vs card.'], [60, 'CSV with one row per order to match the POS.'], [110, 'Close day wipes guest names everywhere.']]} />
      </Sequence>

      <Sequence from={T.facts.from} durationInFrames={T.facts.dur}><Facts /></Sequence>
      <Sequence from={T.outro.from} durationInFrames={T.outro.dur}><Outro /></Sequence>
    </AbsoluteFill>
  );
};
