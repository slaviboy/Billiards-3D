/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * This file is part of Pool.
 *
 * Pool is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version. See the LICENSE file for the full terms.
 */

// Online play in the interface: hosting (the terms, the warning, the link and its QR code),
// joining from a link (in the address bar, pasted, or a game this tab was playing before a
// reload), the connection's state beside the cards, video and voice on the cards, the other
// player's cue from their previews, and what the session reports (arrivals, offers, rule breaks).
// Every online game starts with the 18+ and IP warning, its box unticked, before anything
// connects; the development hook is removed for good once one begins.

import type { App } from '../../app/App.ts';
import { cueSpeed } from '../../app/App.ts';
import { removeDebugHook } from '../../app/debugHook.ts';
import { PoolPort, type CueAim, type PortTable } from '../../game/GamePort.ts';
import { POOL_CODEC, type GameMessage, type PoolTerms } from '../../game/gameMessages.ts';
import { YAW_STEPS, type ShotCode } from '../../game/shotCodec.ts';
import { openPeerLink } from '../../net/PeerLink.ts';
import {
  OnlineSession,
  type OnlineState,
  type SavedSession,
  type SessionEvent,
} from '../../net/OnlineSession.ts';
import {
  cleanName,
  createInvite,
  inviteUrl,
  parseInvite,
  roomFor,
  type Invite,
} from '../../net/protocol.ts';
import { tabStorage } from '../../net/savedSession.ts';
import { syncServerTime } from '../../net/serverTime.ts';
import type { Seat } from '../../rules/types.ts';
import { CardMedia, type MediaView } from '../cardMedia.ts';
import { dialogOpen, el } from '../Dialog.ts';
import { iconButton } from '../modern/controls.ts';
import {
  consentDialog,
  joinDialog,
  noticeDialog,
  offerDialog,
  onlineTermsDialog,
  waitDialog,
  type ConsentKind,
} from '../onlineDialogs.ts';
import type { UiRoot } from '../UiRoot.ts';
import type { OnlineHooks } from './hooks.ts';

type PoolSession = OnlineSession<GameMessage, PoolTerms>;

function randomSeed(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const coin = (): Seat => (crypto.getRandomValues(new Uint8Array(1))[0]! & 1) as Seat;

/** The aim the interface draws for a cue code (the inverse of App.shotCode). */
function aimFor(code: ShotCode, pull: number) {
  const speed = code.speed / 1000;
  return {
    heading: (code.yaw / YAW_STEPS) * 2 * Math.PI,
    elevation: code.pitch / 10,
    power: Math.sqrt(Math.max(0, speed - cueSpeed(0)) / (cueSpeed(1) - cueSpeed(0))),
    a: code.a / 1000,
    b: code.b / 1000,
    pull,
  };
}

export class OnlinePlay implements OnlineHooks {
  private session: PoolSession | null = null;
  private port: PoolPort | null = null;
  private offs: Array<() => void> = [];
  private readonly storage = tabStorage(POOL_CODEC);
  /** An invitation from the address bar, waiting for the player to accept the warning. */
  private pendingInvite: Invite | null = null;
  private readonly chip: HTMLElement;
  private readonly chipText: HTMLElement;
  /** The other player's voice: one element for the whole game, never a video's. */
  private readonly voice: HTMLAudioElement;
  private readonly media: [CardMedia, CardMedia];
  private lastMediaError: string | null = null;
  private claimOffered = false;

  constructor(
    private readonly app: App,
    private readonly ui: UiRoot,
  ) {
    ui.online = this;
    this.readInvite();
    window.addEventListener('hashchange', () => {
      if (this.readInvite()) void this.checkInvitation();
    });

    this.chip = el('div', 'online-chip');
    this.chip.dataset.testid = 'online';
    this.chip.setAttribute('role', 'status');
    this.chip.hidden = true;
    this.chipText = el('span', 'online-chip-text');
    this.chip.append(el('span', 'online-chip-dot'), this.chipText);
    ui.element.append(this.chip);

    this.voice = document.createElement('audio');
    this.voice.autoplay = true;
    this.voice.hidden = true;
    document.body.append(this.voice);

    const commands = {
      toggleMic: () => void this.session?.media.toggleMic(),
      toggleCam: () => void this.session?.media.toggleCam(),
      toggleSpeaker: () => this.session?.media.toggleSpeaker(),
    };
    const makeButton = (icon: string, label: string, onClick: () => void) =>
      iconButton(icon, label, onClick, 'm-icon-btn m-media-btn');
    this.media = [
      new CardMedia(commands, makeButton, 'm-avatar-video'),
      new CardMedia(commands, makeButton, 'm-avatar-video'),
    ];
    for (const seat of [0, 1] as const) {
      ui.playerCard(seat).attachMedia(this.media[seat].video, this.media[seat].controls);
    }
    // The cards show video and voice once the match (and so this device's seat) is set up.
    app.match.state.subscribe(() => {
      this.renderChip();
      this.renderMedia();
    });
  }

  // --- what the interface asks ---------------------------------------------------------------

  get active(): boolean {
    return !!this.session && !this.session.closed;
  }

  get seat(): Seat | null {
    return this.port && this.app.match.current.setup.mode === 'online' ? this.port.seat : null;
  }

  async intercept(): Promise<boolean> {
    return this.checkInvitation();
  }

  async host(): Promise<boolean> {
    const settings = this.app.settings.get();
    const chosen = await onlineTermsDialog(settings);
    if (!chosen) return false;
    if (this.active && !(await this.leaveForNewMatch())) return false;
    const consent = await this.askConsent('host');
    if (!consent) return false;
    this.app.settings.update({
      table: chosen.size,
      race: chosen.race,
      shotClock: chosen.shotClock,
    });
    const invite = createInvite();
    const seed = randomSeed();
    const firstBreak: Seat =
      chosen.firstBreak === 'toss' ? coin() : chosen.firstBreak === 'host' ? 0 : 1;
    const options = await this.options(invite);
    const session = OnlineSession.host<GameMessage, PoolTerms>({
      ...options,
      name: consent.name,
      terms: (friend) => ({
        seed,
        race: chosen.race,
        shotClock: chosen.shotClock,
        size: chosen.size,
        names: [cleanName(consent.name, 'Player'), friend],
        host: 0,
        firstBreak,
      }),
    });
    this.begin(session, options.port);
    const result = await waitDialog(session.state, inviteUrl(location.href, invite));
    if (result !== 'playing' && this.session === session) await this.end();
    return result === 'playing';
  }

  async join(): Promise<boolean> {
    const invite = await joinDialog();
    if (!invite) return false;
    if (this.active && !(await this.leaveForNewMatch())) return false;
    const consent = await this.askConsent('guest');
    if (!consent) return false;
    return this.joinWith(invite, consent.name);
  }

  async rematch(): Promise<void> {
    const session = this.session;
    if (!session || session.closed) {
      this.ui.say('Your friend has left. Start a new game from the menu.');
      return;
    }
    const consent = await this.askConsent('rematch', session.state.get().myName);
    if (!consent || session.closed) return;
    const asked = session.state.get().rematch !== 'received';
    await session.requestRematch();
    if (asked) this.ui.say(`Waiting for ${session.state.get().friendName} to accept the rematch…`);
  }

  async resign(): Promise<void> {
    const session = this.session;
    if (!session || session.closed || this.app.match.current.winner !== null) return;
    const friend = session.state.get().friendName;
    const sure = await offerDialog(
      'Resign the match?',
      `${friend} wins the match. You stay connected, for a rematch.`,
      'Resign',
      'Keep playing',
    );
    if (sure) await session.resign();
  }

  async leave(): Promise<void> {
    if (await this.leaveForNewMatch()) {
      this.ui.say('You left the online game.');
      await this.ui.menu();
    }
  }

  async leaveForNewMatch(): Promise<boolean> {
    const session = this.session;
    if (!session || session.closed) {
      await this.end();
      return true;
    }
    const { status, friendName } = session.state.get();
    const playing = session.matchStarted && this.app.match.current.winner === null;
    if (playing && status !== 'waiting') {
      const ok = await offerDialog(
        'Leave the online game?',
        `You lose the match if you leave now. ${friendName} wins.`,
        'Leave',
        'Stay',
      );
      if (!ok) return false;
    }
    await this.end();
    return true;
  }

  remoteClock(): { used: number; limit: number } | null {
    return this.active ? (this.port?.remoteClock() ?? null) : null;
  }

  // --- joining -------------------------------------------------------------------------------

  /** Takes the invitation from the address bar, if any, and clears it from there. */
  private readInvite(): boolean {
    if (!location.hash.startsWith('#g=')) return false;
    const invite = parseInvite(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (invite) this.pendingInvite = invite;
    return invite !== null;
  }

  /** An invitation in the address bar, or a game this tab was playing before a reload. */
  private async checkInvitation(): Promise<boolean> {
    await this.app.ready;
    const invite = this.pendingInvite;
    this.pendingInvite = null;
    if (invite) {
      if (this.active && !(await this.leaveForNewMatch())) return true;
      const consent = await this.askConsent('guest');
      if (!consent) return false;
      return this.joinWith(invite, consent.name);
    }
    const saved = this.storage.load();
    if (!saved || this.session) return false;
    const consent = await this.askConsent('rejoin', saved.name);
    if (!consent) {
      this.storage.clear();
      return false;
    }
    return this.resume(saved, consent.name);
  }

  private async joinWith(invite: Invite, name: string): Promise<boolean> {
    const options = await this.options(invite);
    const session = OnlineSession.join<GameMessage, PoolTerms>({ ...options, name });
    this.begin(session, options.port);
    return this.waitForHost(session);
  }

  private async resume(saved: SavedSession<GameMessage, PoolTerms>, name: string) {
    const options = await this.options(saved.invite);
    const { invite: _invite, ...rest } = options;
    const session = OnlineSession.resume<GameMessage, PoolTerms>(saved, { ...rest, name });
    this.begin(session, options.port);
    if (saved.role === 'guest') return this.waitForHost(session);
    this.ui.say(`Waiting for ${saved.friendName} to come back…`);
    return true;
  }

  private async waitForHost(session: PoolSession): Promise<boolean> {
    const result = await waitDialog(session.state, null);
    if (result !== 'playing' && this.session === session) await this.end();
    return result === 'playing';
  }

  /** The warning, every time; the name it asks for is remembered as the player's name. */
  private async askConsent(kind: ConsentKind, name = this.app.settings.get().name) {
    const answer = await consentDialog(kind, name);
    if (answer) this.app.settings.update({ name: answer.name });
    return answer;
  }

  private async options(invite: Invite) {
    const port = new PoolPort(this.table());
    // The relays compare times, so first the clock both players will agree on.
    const [room] = await Promise.all([roomFor(invite), syncServerTime()]);
    return {
      link: openPeerLink(invite, room),
      port,
      codec: POOL_CODEC,
      invite,
      build: __POOL_BUILD__,
      storage: this.storage,
    };
  }

  /** What the port needs of this device's table. */
  private table(): PortTable {
    const app = this.app;
    const ui = this.ui;
    return {
      get match() {
        return app.match;
      },
      get playing() {
        return app.playing;
      },
      newMatch: (setup, seats) => ui.beginMatch(setup, seats),
      setLocalSeats: (seats) => {
        app.localSeats = seats;
        app.refresh();
        ui.render();
      },
      shoot: (code, intent, placement) => app.shoot(code, intent, placement),
      afterShot: (result) => void ui.afterShot(result),
      showBalls: () => app.showBalls(),
      aimAtRack: () => app.aimAtRack(),
      localAim: () => ({ code: app.shotCode, pull: app.drawn }),
      showRemoteAim: (aim: CueAim | null) => {
        if (aim) {
          const { pull, ...shown } = aimFor(aim.code, aim.pull);
          app.aim = shown;
          app.remoteCue = true;
          app.setPull(pull);
        } else if (app.remoteCue) {
          app.remoteCue = false;
          app.setPull(0);
        }
        ui.render();
      },
      say: (text) => ui.say(text),
      restored: () => void ui.followUp(),
    };
  }

  // --- following a session -------------------------------------------------------------------

  private begin(session: PoolSession, port: PoolPort): void {
    this.stopFollowing();
    this.session?.dispose();
    this.port?.dispose();
    // The development hook reaches into the whole game; it has no place in a game against a person.
    removeDebugHook();
    this.session = session;
    this.port = port;
    this.claimOffered = false;
    this.offs.push(
      session.state.subscribe((state) => this.onState(session, state)),
      session.onEvent((event) => void this.onEvent(session, event)),
      session.media.state.subscribe(() => this.renderMedia()),
    );
  }

  /** Leaves the online game, if there is one (losing a match still being played). */
  private async end(): Promise<void> {
    const session = this.session;
    const port = this.port;
    this.stopFollowing();
    this.session = null;
    this.port = null;
    if (session) {
      await session.leave();
      session.dispose();
    }
    port?.dispose();
    this.app.remoteCue = false;
    this.renderChip();
    this.renderMedia();
  }

  private stopFollowing(): void {
    for (const off of this.offs.splice(0)) off();
  }

  private onState(session: PoolSession, state: OnlineState): void {
    this.renderChip();
    this.renderMedia();
    if (state.canClaimWin && !this.claimOffered) {
      this.claimOffered = true;
      void this.offerClaim(session);
    }
    if (!state.canClaimWin) this.claimOffered = false;
  }

  private async onEvent(session: PoolSession, event: SessionEvent): Promise<void> {
    const friend = session.state.get().friendName;
    const names = this.app.match.current.setup.names;
    const breaker = names[this.app.match.current.setup.firstBreak];
    switch (event.kind) {
      case 'joined':
        this.ui.say(`${friend} joined. ${breaker} breaks.`);
        break;
      case 'returned':
        this.ui.say(`${friend} is back.`);
        break;
      case 'away':
        this.ui.say(`${friend} lost the connection. Waiting for them to come back…`);
        break;
      case 'resynced':
        this.ui.say('The two tables were brought back in step.');
        break;
      case 'rematchOffered': {
        const next = names[this.app.match.current.setup.firstBreak === 0 ? 1 : 0];
        const text = `${friend} wants a rematch. ${next} would break first.`;
        this.ui.say(text);
        if (dialogOpen()) break;
        if (await offerDialog('Rematch', text, 'Rematch')) await this.rematch();
        break;
      }
      case 'rematchStarted':
        this.ui.say(`Rematch against ${friend}: ${breaker} breaks.`);
        break;
      case 'resigned':
        await noticeDialog('You win the match', `${friend} resigned.`);
        break;
      case 'left':
      case 'violation':
      case 'outOfStep':
      case 'failed':
        // The message arrives with the closing state; give it a moment.
        queueMicrotask(() => {
          const message = session.state.get().message;
          if (message && session.matchStarted) void noticeDialog('Online game over', message);
        });
        break;
    }
  }

  private async offerClaim(session: PoolSession): Promise<void> {
    const friend = session.state.get().friendName;
    this.ui.say(`${friend} has been gone for two minutes. You can claim the win.`);
    if (dialogOpen()) return;
    const claim = await offerDialog(
      'Claim the win?',
      `${friend} has been gone for two minutes. Claim the win, or keep waiting for them.`,
      'Claim the win',
      'Keep waiting',
    );
    if (claim) await session.claimWin();
  }

  // --- drawing -------------------------------------------------------------------------------

  /** The connection beside the cards: who, how it is, and the table's fingerprint for tests. */
  private renderChip(): void {
    const session = this.session;
    const match = this.app.match.current;
    const online = match.setup.mode === 'online' && session !== null;
    this.chip.hidden = !online;
    if (!online || !session) return;
    const s = session.state.get();
    let text: string;
    if (s.status === 'waiting') text = 'Waiting for your friend…';
    else if (s.status === 'connecting') text = 'Connecting…';
    else if (s.status === 'away') text = `${s.friendName} lost the connection…`;
    else if (s.status === 'closed' || s.status === 'failed') text = 'Offline';
    else if (s.resyncing) text = 'Bringing the tables back in step…';
    else text = `Online with ${s.friendName}${s.ping !== null ? ` · ${s.ping} ms` : ''}`;
    this.chipText.textContent = text;
    this.chip.dataset.status = s.resyncing ? 'resyncing' : s.status;
    this.chip.dataset.hash = this.app.match.hash();
    this.chip.dataset.shot = String(match.shot);
    this.chip.dataset.turn = String(match.rack.turn);
    this.chip.dataset.phase = match.rack.phase;
    this.chip.dataset.seat = String(this.port?.seat ?? '');
  }

  private mediaView(): MediaView | null {
    const session = this.session;
    if (!session || session.closed || this.seat === null) return null;
    const media = session.media.state.get();
    return {
      me: this.seat,
      friendName: session.state.get().friendName,
      mic: media.mic,
      cam: media.cam,
      preview: media.preview,
      friendVideo: media.friendVideo,
      friendSound: media.friendAudio !== null,
      speakerMuted: media.speakerMuted,
    };
  }

  private renderMedia(): void {
    const session = this.session;
    const media = session && !session.closed ? session.media.state.get() : null;
    const sound = media?.friendAudio ?? null;
    if (this.voice.srcObject !== sound) {
      this.voice.srcObject = sound;
      if (sound) void this.voice.play().catch(() => undefined);
    }
    this.voice.muted = media?.speakerMuted ?? false;
    const error = media?.error ?? null;
    if (error && error !== this.lastMediaError) this.ui.say(error);
    this.lastMediaError = error;
    const view = this.mediaView();
    for (const seat of [0, 1] as const) {
      const on = this.media[seat].render(view, seat);
      this.ui.playerCard(seat).setVideo(on);
    }
  }
}
