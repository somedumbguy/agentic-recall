import { RingBuffer } from "../lib/ring-buffer.ts";

describe("RingBuffer", () => {
  it("returns empty array when empty", () => {
    const rb = new RingBuffer<number>(5);
    expect(rb.toArray()).toEqual([]);
    expect(rb.size()).toBe(0);
  });

  it("stores items up to capacity", () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    expect(rb.toArray()).toEqual([1, 2, 3]);
    expect(rb.size()).toBe(3);
  });

  it("overwrites oldest when full", () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    rb.push(4);
    expect(rb.toArray()).toEqual([2, 3, 4]);
    expect(rb.size()).toBe(3);
  });

  it("wraps correctly through multiple cycles", () => {
    const rb = new RingBuffer<number>(3);
    for (let i = 1; i <= 10; i++) rb.push(i);
    expect(rb.toArray()).toEqual([8, 9, 10]);
  });

  it("clear resets state", () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    rb.clear();
    expect(rb.toArray()).toEqual([]);
    expect(rb.size()).toBe(0);
  });
});
