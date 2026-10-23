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

// The interface over the table: the menu bar (or a menu button), the players' cards and the
// buttons along the top (or, with large cards, the cards beside the table), the power bar on one
// side, the dock with the spin, the fine aim and what is going on along the bottom, the pocket
// markers for calling the 8, and the notes after each shot. It runs the keyboard, the shot clock
// and the turns of a match on this device (decisions, the end of a rack, rematches), and tells the
// camera which parts of the screen it covers, so the table is framed in the rest.

import type { App } from '../app/App.ts';
import { SPEEDS, type Settings } from '../app/Settings.ts';
import type { MatchSetup, MatchState, ShotResult } from '../game/MatchController.ts';
import { commandFor, type Command } from '../input/shortcuts.ts';
import { other } from '../rules/eightBall.ts';
import { CHOICES, type Foul, type Seat } from '../rules/types.ts';
import { dialogOpen, el } from './Dialog.ts';
import {
  CLOTH_NAMES,
  controlsDialog,
  decisionDialog,
  mainMenu,
  newMatchDialog,
  pauseMenu,
  resultDialog,
  rulesDialog,
  settingsDialog,
} from './dialogs.ts';
import { EIGHT_BALL, LINE_ICONS } from './icons.ts';
import type { OnlineHooks } from './online/hooks.ts';
import { iconButton } from './modern/controls.ts';
import { MenuBar, type Menu, type MenuItem } from './modern/MenuBar.ts';
import { PlayerCard } from './modern/PlayerCard.ts';
import { PocketPicker } from './modern/PocketPicker.ts';
import { FineAim, MAX_TIP, PowerBar, SpinPad } from './modern/ShotControls.ts';
import { Toasts } from './modern/Toasts.ts';

const FOUL_TEXT: Record<Foul, string> = {
  scratch: 'Foul: the cue ball went in',
  wrongBallFirst: 'Foul: wrong ball hit first',
  noContact: 'Foul: no ball was hit',
  noRail: 'Foul: no rail after contact',
  badPlayAboveHeadString: 'Foul: the cue ball must leave the kitchen',
  shotClock: 'Foul: time ran out',
};

const GROUP_NAME = ['', 'solids', 'stripes'] as const;

/** Where large cards stand in a row under the buttons rather than beside the table; keep it in
 * step with the same query in pool.css. */
const PHONE_UPRIGHT = '(max-width: 640px) and (orientation: portrait)';

function randomSeed(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class UiRoot {
  readonly element: HTMLElement;
  private readonly cards: [PlayerCard, PlayerCard];
  private readonly race: HTMLElement;
  private readonly status: HTMLElement;
  private readonly power: PowerBar;
  private readonly spin: SpinPad;
  private readonly fine: FineAim;
  private readonly safety: HTMLButtonElement;
  private readonly action: HTMLButtonElement;
  private readonly viewButton: HTMLButtonElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly menuBar: MenuBar;
  /** The game's name and the menu bar, at the start of the top bar when the bar is chosen. */
  private readonly menuHead: HTMLElement;
  private readonly picker: PocketPicker;
  private readonly toasts = new Toasts();
  private readonly top: HTMLElement;
  /** Where the cards stand when they are large. */
  private readonly players: HTMLElement;
  private readonly dock: HTMLElement;
  /** The shot clock: which turn it is timing, and the seconds used. */
  private clock = { key: '', used: 0 };
  private lastTick = performance.now();
  private busyMenu = false;
  /** Online play, where it goes differently (src/ui/online/OnlinePlay.ts sets it). */
  online: OnlineHooks | null = null;
  private deciding = false;

  constructor(private readonly app: App) {
    document.documentElement.dataset.ui = 'modern';
    const scale = () => {
      const factor = Math.min(window.innerWidth / 1024, window.innerHeight / 768);
      document.documentElement.style.setProperty(
        '--ui-scale',
        String(Math.min(1.6, Math.max(0.55, factor))),
      );
    };
    scale();
    window.addEventListener('resize', scale);

    this.element = el('div', 'm-ui pool-ui');

    // Along the top: the menu bar (when chosen), the cards with the race between them, and the
    // buttons, the last of them the menu's when there is no bar.
    this.top = el('div', 'm-topbar hud-top');
    this.menuBar = new MenuBar(
      this.menus(),
      () => this.app.settings.get().menuBar && !dialogOpen(),
    );
    this.menuHead = el('div', 'hud-menus');
    const brand = el('div', 'm-brand');
    brand.setAttribute('aria-label', 'Pool');
    brand.innerHTML = `<span class="m-brand-mark">${EIGHT_BALL}</span><span class="m-brand-name" aria-hidden="true">Pool</span>`;
    this.menuHead.append(brand, this.menuBar.element);
    this.cards = [new PlayerCard(0), new PlayerCard(1)];
    this.race = el('div', 'race');
    this.viewButton = iconButton(LINE_ICONS.topView, 'Top view (T)', () =>
      this.run({ kind: 'toggleView' }),
    );
    this.menuButton = iconButton(LINE_ICONS.menu, 'Menu (Esc)', () => void this.pause());
    const buttons = el('div', 'hud-buttons m-topbar-end');
    buttons.append(
      this.viewButton,
      iconButton(LINE_ICONS.restart, 'Reset the view (Home)', () => this.run({ kind: 'home' })),
      iconButton(LINE_ICONS.fullscreen, 'Full screen', () => this.toggleFullscreen()),
      this.menuButton,
    );
    this.top.append(
      this.menuHead,
      this.cards[0].element,
      this.race,
      this.cards[1].element,
      buttons,
    );
    this.players = el('div', 'hud-players');
    this.players.hidden = true;

    // The power bar along the side.
    this.power = new PowerBar({
      canShoot: () => this.app.canAct(),
      power: () => this.app.aim.power,
      pull: (p) => {
        this.app.aim.power = p;
        this.app.setPull(p);
      },
      release: (p) => {
        this.app.aim.power = p;
        void this.shoot();
      },
      cancel: (previous) => {
        this.app.aim.power = previous;
        this.app.setPull(0);
      },
    });

    // The dock along the bottom.
    this.dock = el('div', 'm-dock hud-dock');
    this.spin = new SpinPad({
      tip: () => ({ a: this.app.aim.a, b: this.app.aim.b }),
      setTip: (a, b) => {
        this.app.aim.a = a;
        this.app.aim.b = b;
        this.app.refresh();
      },
      elevation: () => this.app.elevation,
      setElevation: (degrees) => {
        this.app.aim.elevation = degrees;
        this.app.refresh();
      },
      enabled: () => this.app.canAct(),
    });
    this.fine = new FineAim(
      (angle) => this.run({ kind: 'aim', angle }),
      () => this.app.canAct(),
    );
    this.status = el('div', 'status');
    this.status.dataset.testid = 'status';
    this.safety = el('button', 'chip safety');
    this.safety.type = 'button';
    this.safety.textContent = 'Safety';
    this.safety.dataset.tip = 'Call a safety: the table passes after the shot';
    this.safety.addEventListener('click', () => {
      this.app.safety = !this.app.safety;
      this.render();
    });
    this.action = el('button', 'm-btn m-btn-primary dock-action');
    this.action.type = 'button';
    this.action.addEventListener('click', () => void this.continueMatch());
    const middle = el('div', 'dock-middle');
    const chips = el('div', 'dock-row');
    chips.append(this.status, this.safety, this.action);
    middle.append(chips, this.fine.element);
    this.dock.append(this.spin.element, middle);

    this.picker = new PocketPicker({
      pockets: () => this.app.match.table.pockets,
      size: () => this.app.match.table.spec,
      called: () => this.app.calledPocket,
      call: (pocket) => {
        this.app.calledPocket = pocket;
        this.app.sound.cue('call');
        this.render();
      },
      toClient: (x, y) => this.app.toClient(x, y),
    });

    this.element.append(
      this.top,
      this.players,
      this.power.element,
      this.dock,
      this.toasts.element,
      this.picker.element,
    );
    document.body.append(this.element);
    // A button pressed with the mouse or a finger lets go of the focus, so that Space then shoots
    // rather than pressing it again; one pressed from the keyboard keeps it.
    this.element.addEventListener('click', (event) => {
      if (event.detail > 0) (event.target as HTMLElement).closest('button')?.blur();
    });

    app.onQualityLowered = (fps) =>
      this.toasts.show(`Graphics lowered for smoother play (it ran at ${fps} frames a second)`);
    app.match.state.subscribe(() => this.render());
    app.settings.subscribe((settings) => {
      this.element.classList.toggle('left-handed', settings.leftHanded);
      this.element.classList.toggle('menu-bar', settings.menuBar);
      this.menuHead.hidden = !settings.menuBar;
      this.menuButton.hidden = settings.menuBar;
      if (!settings.menuBar) this.menuBar.close();
      this.placeCards(settings.largeCards);
      this.render();
      this.measure();
    });
    app.scene.addUpdater(() => {
      this.picker.follow();
      return false;
    });
    window.addEventListener('keydown', (event) => this.onKey(event));
    const observer = new ResizeObserver(() => this.measure());
    for (const part of [this.top, this.players, this.dock, this.power.element]) {
      observer.observe(part);
    }
    window.addEventListener('resize', () => this.measure());
    setInterval(() => this.tick(), 100);
    this.render();
    this.measure();
  }

  /** Opens the main menu (at the start, and from the pause menu). */
  async menu(): Promise<void> {
    if (this.busyMenu) return;
    this.busyMenu = true;
    try {
      if (await this.online?.intercept()) return;
      for (;;) {
        const choice = await mainMenu();
        if (choice === 'practice') return await this.startPractice();
        if (choice === 'local') {
          if (await this.startLocal()) return;
          continue;
        }
        if (choice === 'online' || choice === 'join') {
          const online = this.online;
          if (online && (await (choice === 'online' ? online.host() : online.join()))) return;
          continue;
        }
        if (choice === 'settings') await settingsDialog(this.app.settings);
        else if (choice === 'controls') await controlsDialog();
        else if (choice === 'rules') await rulesDialog();
        else return;
      }
    } finally {
      this.busyMenu = false;
    }
  }

  private async startPractice(): Promise<void> {
    if (!(await this.leavesOnline())) return;
    const s = this.app.settings.get();
    await this.app.newMatch({
      mode: 'practice',
      size: s.table,
      race: 1,
      shotClock: 0,
      names: [s.name, s.name2],
      seed: randomSeed(),
      firstBreak: 0,
    });
    this.toasts.clear();
    this.toasts.show('Practice: drag the cue ball anywhere, then shoot');
  }

  /** Asks for the terms and starts a match on this device; false if cancelled. */
  private async startLocal(): Promise<boolean> {
    if (!(await this.leavesOnline())) return false;
    const terms = await newMatchDialog(this.app.settings.get());
    if (!terms) return false;
    this.app.settings.update({
      name: terms.names[0],
      name2: terms.names[1],
      table: terms.size,
      race: terms.race,
      shotClock: terms.shotClock,
    });
    const breaker: Seat =
      terms.firstBreak === 'toss'
        ? crypto.getRandomValues(new Uint8Array(1))[0]! & 1
          ? 1
          : 0
        : terms.firstBreak;
    await this.startMatch({
      mode: 'local',
      size: terms.size,
      race: terms.race,
      shotClock: terms.shotClock,
      names: terms.names,
      seed: randomSeed(),
      firstBreak: breaker,
    });
    this.toasts.show(
      `${terms.firstBreak === 'toss' ? 'Coin toss: ' : ''}${terms.names[breaker]} breaks`,
    );
    return true;
  }

  private async startMatch(setup: MatchSetup): Promise<void> {
    this.toasts.clear();
    this.clock = { key: '', used: 0 };
    await this.app.newMatch(setup);
  }

  // --- for online play (src/ui/online) ---------------------------------------------------------

  /** Starts a match with this device playing `seats` (online: one). */
  async beginMatch(setup: MatchSetup, seats: readonly Seat[]): Promise<void> {
    this.toasts.clear();
    this.clock = { key: '', used: 0 };
    this.app.remoteCue = false;
    await this.app.newMatch(setup, seats);
  }

  /** A note under the cards. */
  say(text: string, kind: 'info' | 'foul' | 'good' = 'info'): void {
    this.toasts.show(text, kind);
  }

  playerCard(seat: Seat): PlayerCard {
    return this.cards[seat];
  }

  /** Whatever the rules ask of this device next, after the table was replaced (a decision). */
  async followUp(): Promise<void> {
    this.render();
    if (this.app.match.current.rack.phase === 'decision') await this.decide();
  }

  /** Before a match on this device replaces an online one: leaves it, unless the player stays. */
  private async leavesOnline(): Promise<boolean> {
    return !this.online || (await this.online.leaveForNewMatch());
  }

  /** The pause menu. */
  async pause(): Promise<void> {
    if (dialogOpen()) return;
    const state = this.app.match.current;
    const online = state.setup.mode === 'online' && (this.online?.active ?? false);
    const choice = await pauseMenu({
      canConcede: this.canConcede(),
      ...(online ? { online: { canResign: state.winner === null } } : {}),
    });
    switch (choice) {
      case 'newGame':
        if (state.setup.mode === 'practice') await this.startPractice();
        else if (!(await this.startLocal())) await this.pause();
        break;
      case 'settings':
        await settingsDialog(this.app.settings);
        break;
      case 'controls':
        await controlsDialog();
        break;
      case 'rules':
        await rulesDialog();
        break;
      case 'concede':
        await this.concede();
        break;
      case 'menu':
        await this.menu();
        break;
      case 'resign':
        await this.online?.resign();
        break;
      case 'leave':
        await this.online?.leave();
        break;
      default:
        break;
    }
  }

  /** Whether the player at the table may concede the rack (in a match on this device). */
  private canConcede(): boolean {
    const state = this.app.match.current;
    return state.setup.mode === 'local' && state.winner === null && state.rack.phase !== 'over';
  }

  /** The player at the table concedes the rack. */
  private async concede(): Promise<void> {
    if (!this.canConcede()) return;
    this.app.match.concede(this.app.match.current.rack.turn);
    this.app.showBalls();
    await this.afterRack();
  }

  /** Shoots the shot lined up, if everything it needs is set. */
  async shoot(): Promise<void> {
    const app = this.app;
    if (!app.canAct()) return;
    if (app.match.needsCall() && app.calledPocket === null) {
      app.setPull(0);
      this.toasts.show('Call a pocket for the 8 first: tap one of the pockets');
      this.render();
      return;
    }
    this.render();
    const result = await app.shoot();
    await this.afterShot(result);
  }

  /** After a shot has played: the notes, then whatever the rules ask next. */
  async afterShot(result: ShotResult): Promise<void> {
    const state = this.app.match.current;
    const names = state.setup.names;
    const ruling = result.ruling;
    this.render();
    if (!ruling) return;
    for (const foul of ruling.fouls) this.toasts.show(FOUL_TEXT[foul], 'foul');
    if (ruling.fouls.length > 0) this.app.sound.cue('foul');
    if (ruling.assigned) {
      const { seat, group } = ruling.assigned;
      this.toasts.show(`${names[seat]} takes the ${GROUP_NAME[group]}`, 'good');
    }
    if (state.rack.phase === 'play' && !ruling.continues) {
      const next = names[state.rack.turn];
      this.toasts.show(ruling.fouls.length > 0 ? `${next}: ball in hand` : `${next} to shoot`);
    }
    if (state.rack.phase === 'decision' && state.rack.decision) {
      await this.decide();
    } else if (state.rack.phase === 'over') {
      await this.afterRack();
    }
  }

  private async decide(): Promise<void> {
    const state = this.app.match.current;
    const kind = state.rack.decision;
    if (!kind) return;
    // Online, the other player decides on their own device; their choice arrives as a message.
    const mine = this.online?.seat ?? null;
    if (state.setup.mode === 'online' && mine !== null && state.rack.turn !== mine) return;
    if (this.deciding) return;
    this.deciding = true;
    try {
      const choice = await decisionDialog(kind, state.setup.names[state.rack.turn], CHOICES[kind]);
      // Online, the table may have changed meanwhile (the host's taken, or time called).
      const now = this.app.match.current.rack;
      if (now.phase !== 'decision' || now.decision !== kind || now.turn !== state.rack.turn) return;
      this.app.match.decide(choice);
      if (choice !== 'accept' && choice !== 'spot') this.app.sound.racked();
    } finally {
      this.deciding = false;
    }
    this.app.showBalls();
    this.app.aimAtRack();
    this.render();
  }

  /** The end of a rack: the result, then the next rack, a rematch or the menu. */
  private async afterRack(): Promise<void> {
    const state = this.app.match.current;
    const rack = state.rack;
    if (rack.phase !== 'over' || rack.winner === null) return;
    const names = state.setup.names;
    const winner = names[rack.winner];
    const loser = names[other(rack.winner)];
    const reason = {
      eight: `${winner} pocketed the 8 in the called pocket.`,
      eightEarly: `${loser} pocketed the 8 before clearing their group.`,
      eightFoul: `${loser} pocketed the 8 on a foul.`,
      eightPocket: `${loser} pocketed the 8 in a pocket that was not called.`,
      concede: `${loser} conceded the rack.`,
    }[rack.end ?? 'concede'];
    const matchOver = state.winner !== null;
    this.app.sound.cue(matchOver ? 'match' : 'rack');
    const choice = await resultDialog({
      title: matchOver ? `${winner} wins the match` : `${winner} wins the rack`,
      detail: reason,
      names,
      score: state.score,
      matchOver,
    });
    if (choice === 'next' || choice === 'rematch') await this.continueMatch();
    else if (choice === 'menu') await this.menu();
    this.render();
  }

  /** The next rack, or after the match a rematch with the other player breaking. */
  private async continueMatch(): Promise<void> {
    const state = this.app.match.current;
    if (state.winner !== null) {
      // Online, both players must ask; the session starts it on both sides.
      if (state.setup.mode === 'online' && this.online) return this.online.rematch();
      const setup = state.setup;
      const firstBreak = other(setup.firstBreak);
      await this.startMatch({ ...setup, seed: randomSeed(), firstBreak });
      this.toasts.show(`Rematch: ${setup.names[firstBreak]} breaks`);
      return;
    }
    if (state.rack.phase !== 'over') return;
    // Online, the next rack starts by itself on both sides at once (src/game/GamePort.ts).
    if (state.setup.mode === 'online' && this.online) return;
    this.app.match.nextRack();
    this.app.sound.racked();
    this.app.showBalls();
    this.app.aimAtRack();
    this.clock = { key: '', used: 0 };
    this.toasts.show(`${state.setup.names[this.app.match.current.rack.turn]} breaks`);
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  /** The menu bar: what the main and pause menus offer, and the settings used most, at a click. */
  private menus(): Menu[] {
    const app = this.app;
    const settings = app.settings;
    const sep: MenuItem = { separator: true };
    const toggle = (
      label: string,
      key: 'keepZoom' | 'largeCards' | 'leftHanded' | 'sound',
      shortcut?: string,
    ): MenuItem => ({
      label,
      ...(shortcut ? { shortcut } : {}),
      checked: () => settings.get()[key],
      action: () => settings.update({ [key]: !settings.get()[key] }),
    });
    const choose = <K extends 'guide' | 'speed' | 'cloth' | 'quality'>(
      key: K,
      options: readonly (readonly [Settings[K], string])[],
    ): MenuItem[] =>
      options.map(([value, label]) => ({
        label,
        checked: () => settings.get()[key] === value,
        action: () => settings.update({ [key]: value }),
      }));
    const online = () => this.online;
    return [
      {
        label: '&Game',
        items: () => {
          const state = app.match.current;
          const items: MenuItem[] = [
            { label: '&Practice', action: () => void this.startPractice() },
            { label: '&Two players…', action: () => void this.startLocal() },
            {
              label: 'Play a friend &online…',
              enabled: () => online() !== null,
              action: () => void online()?.host(),
            },
            {
              label: '&Join a game…',
              enabled: () => online() !== null,
              action: () => void online()?.join(),
            },
          ];
          if (state.setup.mode === 'online' && online()?.active) {
            items.push(sep);
            if (state.winner === null) {
              items.push({ label: '&Resign the match', action: () => void online()?.resign() });
            }
            items.push({ label: '&Leave the online game', action: () => void online()?.leave() });
          } else if (state.setup.mode === 'local') {
            items.push(sep, {
              label: '&Concede the rack',
              enabled: () => this.canConcede(),
              action: () => void this.concede(),
            });
          }
          return items;
        },
      },
      {
        label: '&View',
        items: () => [
          {
            label: '&Top view',
            shortcut: 'T',
            checked: () => app.rig.view === 'top',
            action: () => this.run({ kind: 'toggleView' }),
          },
          { label: '&Reset the view', shortcut: 'Home', action: () => this.run({ kind: 'home' }) },
          {
            label: 'Look from the &other end',
            shortcut: 'F',
            action: () => this.run({ kind: 'flip' }),
          },
          {
            label: '&Full screen',
            checked: () => document.fullscreenElement !== null,
            action: () => this.toggleFullscreen(),
          },
          sep,
          {
            label: '&Aiming guide',
            shortcut: 'G',
            submenu: () =>
              choose('guide', [
                ['long', 'Long'],
                ['short', 'Short'],
                ['off', 'Off'],
              ]),
          },
          toggle('&Keep the zoom while turning', 'keepZoom'),
          sep,
          toggle('Large player &cards', 'largeCards'),
          toggle('Controls on the &left', 'leftHanded'),
        ],
      },
      {
        label: '&Options',
        items: () => [
          toggle('&Sound', 'sound', 'M'),
          {
            label: 'Shot &playback',
            submenu: () =>
              choose(
                'speed',
                SPEEDS.map((x) => [x, `${x}×`] as const),
              ),
          },
          {
            label: '&Cloth',
            submenu: () =>
              choose(
                'cloth',
                (Object.keys(CLOTH_NAMES) as (keyof typeof CLOTH_NAMES)[]).map(
                  (c) => [c, CLOTH_NAMES[c]] as const,
                ),
              ),
          },
          {
            label: '&Graphics, after a reload',
            submenu: () =>
              choose('quality', [
                ['auto', 'Auto'],
                ['high', 'High'],
                ['low', 'Low'],
              ]),
          },
          sep,
          { label: 'All &settings…', action: () => void settingsDialog(settings) },
        ],
      },
      {
        label: '&Help',
        items: () => [
          { label: '&Keyboard and mouse', shortcut: '?', action: () => void controlsDialog() },
          { label: '&Rules of 8-ball', action: () => void rulesDialog() },
        ],
      },
    ];
  }

  private onKey(event: KeyboardEvent): void {
    if (dialogOpen()) return;
    // An open menu takes the keys (its own handle them where it has the focus); Escape shuts it.
    if (this.menuBar.isOpen) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.menuBar.close();
      }
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [role="menubar"]')) return;
    const command = commandFor(event);
    if (!command) return;
    // Space and Enter on a focused button press that button.
    if (command.kind === 'shoot' && target?.closest('button, [role="slider"]')) return;
    event.preventDefault();
    this.run(command);
  }

  /** Carries out a command from the keyboard or a button. */
  run(command: Command): void {
    const app = this.app;
    const aim = app.aim;
    switch (command.kind) {
      case 'orbit':
        app.rig.orbit(command.azimuth, command.elevation);
        break;
      case 'zoom':
        app.rig.zoom(command.factor);
        break;
      case 'home':
        app.rig.home();
        break;
      case 'flip':
        app.rig.flip();
        break;
      case 'toggleView':
        app.setView(app.rig.view === '3d' ? 'top' : '3d');
        break;
      case 'aim':
        if (!app.canAct()) return;
        aim.heading += command.angle;
        app.refresh();
        break;
      case 'power':
        if (!app.canAct()) return;
        aim.power = Math.max(0, Math.min(1, aim.power + command.delta));
        break;
      case 'tip': {
        if (!app.canAct()) return;
        let a = aim.a + command.a;
        let b = aim.b + command.b;
        const length = Math.hypot(a, b);
        if (length > MAX_TIP) {
          a *= MAX_TIP / length;
          b *= MAX_TIP / length;
        }
        aim.a = Math.round(a * 1000) / 1000;
        aim.b = Math.round(b * 1000) / 1000;
        app.refresh();
        break;
      }
      case 'centreTip':
        if (!app.canAct()) return;
        aim.a = 0;
        aim.b = 0;
        app.refresh();
        break;
      case 'shoot':
        void this.shoot();
        break;
      case 'guide': {
        const order = ['long', 'short', 'off'] as const;
        const next = order[(order.indexOf(app.settings.get().guide) + 1) % order.length]!;
        app.settings.update({ guide: next });
        this.toasts.show(`Aiming guide: ${next}`);
        break;
      }
      case 'sound': {
        const on = !app.settings.get().sound;
        app.settings.update({ sound: on });
        this.toasts.show(on ? 'Sound on' : 'Sound off');
        break;
      }
      case 'pause':
        if (this.power.cancelPull()) break;
        void this.pause();
        break;
      case 'newGame':
        if (app.match.current.setup.mode === 'practice') void this.startPractice();
        else void this.startLocal();
        break;
      case 'help':
        void controlsDialog();
        break;
    }
    this.render();
  }

  /** Runs the shot clock while a player at this device is to shoot. */
  private tick(): void {
    const now = performance.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    const state = this.app.match.current;
    const limit = state.setup.shotClock;
    // Online, both clocks are kept by the game's port (src/game/GamePort.ts), alike on both sides.
    const online = state.setup.mode === 'online' && this.online !== null;
    if (limit <= 0 || online || !this.app.canAct()) {
      this.renderClock(state);
      return;
    }
    const key = `${state.rackNumber}:${state.shot}:${state.rack.turn}:${state.rack.phase}`;
    if (key !== this.clock.key) this.clock = { key, used: 0 };
    // The clock stops while a menu or dialog is open.
    if (!dialogOpen() && !this.power.pulling) this.clock.used += dt;
    if (this.clock.used >= limit) {
      this.clock.used = 0;
      this.app.match.timeOut();
      this.app.showBalls();
      this.toasts.show(FOUL_TEXT.shotClock, 'foul');
      this.app.sound.cue('foul');
      this.toasts.show(`${state.setup.names[this.app.match.current.rack.turn]}: ball in hand`);
    }
    this.renderClock(this.app.match.current);
  }

  private renderClock(state: MatchState): void {
    const limit = state.setup.shotClock;
    const timing = limit > 0 && this.app.canAct(state);
    // Online, the clocks the game's port keeps (the other player's with the network's allowance).
    const online = state.setup.mode === 'online' ? this.online : null;
    for (const seat of [0, 1] as const) {
      const kept = online && limit > 0 ? online.clockFor(seat) : null;
      const active = online ? kept !== null : timing && state.rack.turn === seat;
      const used = kept ? kept.used : this.clock.used;
      const allowed = kept ? kept.limit : limit;
      this.cards[seat].render({
        ...this.cardView(state, seat),
        clock: active ? Math.max(0, 1 - used / allowed) : null,
        seconds: active ? Math.ceil(Math.max(0, allowed - used)) : null,
      });
    }
  }

  private cardView(state: MatchState, seat: Seat) {
    const onTable = this.app.match.onTable(state);
    const practice = state.setup.mode === 'practice';
    const rack = state.rack;
    const group = rack.groups[seat];
    let note: string | null = null;
    if (practice) note = `Practice · shot ${state.shot + 1}`;
    else if (rack.phase === 'break') note = rack.turn === seat ? 'To break' : '';
    else if (group === 0) note = 'Open table';
    return {
      name: state.setup.names[seat],
      score: state.score[seat],
      group,
      onTable,
      active:
        state.winner === null &&
        rack.phase !== 'over' &&
        (practice ? seat === 0 : rack.turn === seat),
      note,
      clock: null,
      seconds: null,
    };
  }

  /** Brings everything in line with the match. */
  render(): void {
    const app = this.app;
    const state = app.match.current;
    const practice = state.setup.mode === 'practice';
    this.element.classList.toggle('practice', practice);
    this.cards[1].element.hidden = practice;
    this.race.textContent = practice ? 'Practice' : `Race to ${state.setup.race}`;
    this.renderClock(state);

    const canAct = app.canAct();
    const needsCall = canAct && app.match.needsCall();
    this.status.textContent = this.statusText(state, needsCall);
    this.safety.hidden = practice || state.rack.phase !== 'play';
    this.safety.disabled = !canAct;
    this.safety.classList.toggle('on', app.safety);
    this.safety.setAttribute('aria-pressed', String(app.safety));
    const over = state.rack.phase === 'over' && !app.playing;
    this.action.hidden = !over;
    this.action.textContent = state.winner !== null ? 'Rematch' : 'Next rack';
    this.power.render();
    this.spin.render();
    this.fine.render();
    this.picker.render(needsCall && !app.playing);
    const top = app.rig.view === 'top';
    this.viewButton.innerHTML = top ? LINE_ICONS.perspective : LINE_ICONS.topView;
    const label = top ? '3D view (T)' : 'Top view (T)';
    this.viewButton.setAttribute('aria-label', label);
    this.viewButton.dataset.tip = label;
  }

  private statusText(state: MatchState, needsCall: boolean): string {
    const app = this.app;
    const names = state.setup.names;
    const rack = state.rack;
    const name = names[rack.turn];
    if (app.playing) return '';
    if (state.winner !== null) return `${names[state.winner]} wins the match`;
    if (rack.phase === 'over') return `${names[rack.winner ?? 0]} wins the rack`;
    if (rack.phase === 'decision') return `${name} to choose`;
    if (state.setup.mode === 'practice') {
      return app.match.inHand() ? 'Ball in hand: drag the cue ball' : 'Line up a shot';
    }
    if (rack.phase === 'break') return `${name} to break · ball in hand behind the head string`;
    if (needsCall) {
      return app.calledPocket === null
        ? `${name}: call a pocket for the 8`
        : `${name}: on the 8 · pocket called`;
    }
    if (app.match.inHand() === 'table') return `${name}: ball in hand`;
    return `${name} to shoot`;
  }

  /** The cards in the top bar, with the race between them, or large on their own. */
  private placeCards(large: boolean): void {
    const [first, second] = this.cards;
    if (large) {
      this.players.append(first.element, second.element);
    } else {
      this.race.before(first.element);
      this.race.after(second.element);
    }
    this.players.hidden = !large;
    this.element.classList.toggle('large-cards', large);
    for (const card of this.cards) card.setLarge(large);
  }

  /**
   * Tells the camera how much of each edge the interface covers, the large cards where the top
   * bar ends (they start under it on a phone held upright, or with the menu bar), and the notes
   * where the top's parts end. Large cards cover the side away from the power bar, or the top on
   * a phone held upright.
   */
  private measure(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const top = this.top.getBoundingClientRect();
    this.element.style.setProperty('--bar-bottom', `${Math.round(top.bottom)}px`);
    const dock = this.dock.getBoundingClientRect();
    const power = this.power.element.getBoundingClientRect();
    const left = this.app.settings.get().leftHanded;
    const side = power.width > 0 ? (left ? power.right : w - power.left) : 0;
    const insets = {
      top: Math.max(0, top.bottom),
      bottom: dock.height > 0 ? Math.max(0, h - dock.top) : 0,
      right: left ? 0 : side,
      left: left ? side : 0,
    };
    const players = this.players.getBoundingClientRect();
    if (!this.players.hidden && players.width > 0) {
      const inRow = window.matchMedia(PHONE_UPRIGHT).matches;
      if (inRow) insets.top = Math.max(insets.top, players.bottom);
      else if (left) insets.right = Math.max(0, w - players.left);
      else insets.left = Math.max(0, players.right);
    }
    this.element.style.setProperty('--hud-top', `${Math.round(insets.top)}px`);
    this.app.setInsets(insets);
  }
}
