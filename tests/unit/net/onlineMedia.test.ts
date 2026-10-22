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

import { describe, expect, it } from 'vitest';
import { OnlineMedia } from '../../../src/net/OnlineMedia.ts';
import { FakeTrack, asTrack, devices } from '../../support/fakeMedia.ts';
import { MemoryLink } from '../../support/memoryLink.ts';

function media(denied = false) {
  const d = devices(denied);
  const link = new MemoryLink();
  const reports: Array<[boolean, boolean]> = [];
  const m = new OnlineMedia(link, {
    ...d.options,
    onLocalChange: (mic, cam) => reports.push([mic, cam]),
  });
  return { ...d, link, m, reports };
}

describe('OnlineMedia', () => {
  it('starts with everything off and asks for a device only when it is turned on', async () => {
    const { m, asked, link } = media();
    expect(m.state.get()).toMatchObject({ mic: 'off', cam: 'off', preview: null });
    expect(asked).toEqual([]);
    await m.toggleMic();
    expect(asked).toHaveLength(1);
    expect(asked[0]!.video).toBeUndefined();
    expect(m.state.get().mic).toBe('on');
    expect([...link.tracks.keys()].map((t) => t.kind)).toEqual(['audio']);
  });

  it('turning the camera off stops the device itself and stops sending it', async () => {
    const { m, link, started, reports } = media();
    await m.toggleCam();
    expect(m.state.get()).toMatchObject({ cam: 'on' });
    expect(m.state.get().preview).not.toBeNull();
    await m.toggleCam();
    expect(started[0]!.readyState).toBe('ended');
    expect(link.tracks.size).toBe(0);
    expect(m.state.get()).toMatchObject({ cam: 'off', preview: null });
    expect(reports).toEqual([
      [false, true],
      [false, false],
    ]);
  });

  it('says so when the browser blocks a device, and sends nothing', async () => {
    const { m, link } = media(true);
    await m.toggleCam();
    expect(m.state.get().cam).toBe('blocked');
    expect(m.state.get().error).toMatch(/camera is blocked/);
    expect(link.tracks.size).toBe(0);
  });

  it("shows the other player's media from the tracks that arrive, not from what they say", () => {
    const { m } = media();
    const voice = new FakeTrack('audio');
    voice.muted = true;
    m.receive(asTrack(voice));
    expect(m.state.get().friendAudio).toBeNull();
    voice.mute(false);
    expect(m.state.get().friendAudio).not.toBeNull();
    const camera = new FakeTrack('video');
    m.receive(asTrack(camera));
    expect(m.state.get().friendVideo).not.toBeNull();
    camera.mute(true);
    expect(m.state.get().friendVideo).toBeNull();
    camera.mute(false);
    camera.end();
    expect(m.state.get().friendVideo).toBeNull();
  });

  it('takes one picture and one sound from the other player, and stops any extra', () => {
    const { m } = media();
    const first = new FakeTrack('video');
    const second = new FakeTrack('video');
    m.receive(asTrack(first));
    const shown = m.state.get().friendVideo;
    m.receive(asTrack(second));
    expect(second.readyState).toBe('ended');
    expect(m.state.get().friendVideo).toBe(shown);
    // Once the first one ends (the camera was turned off), a new one is welcome.
    first.end();
    const third = new FakeTrack('video');
    m.receive(asTrack(third));
    expect(third.readyState).toBe('live');
    expect(m.state.get().friendVideo).not.toBe(shown);
  });

  it('the speaker toggle mutes the other player on this device only', () => {
    const { m } = media();
    m.toggleSpeaker();
    expect(m.state.get().speakerMuted).toBe(true);
  });

  it('stopping turns every device off and lets go of the other player', async () => {
    const { m, started, link } = media();
    await m.toggleMic();
    await m.toggleCam();
    m.receive(asTrack(new FakeTrack('video')));
    m.stop();
    expect(started.every((t) => t.readyState === 'ended')).toBe(true);
    expect(link.tracks.size).toBe(0);
    expect(m.state.get()).toMatchObject({ mic: 'off', cam: 'off', friendVideo: null });
    await m.toggleCam();
    expect(m.state.get().cam).toBe('off');
  });
});
