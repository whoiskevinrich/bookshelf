import { describe, it, expect, afterEach } from "vitest";
import { supportsCameraScan } from "./device";

function setGetUserMedia(present: boolean) {
  Object.defineProperty(navigator, "mediaDevices", {
    value: present ? { getUserMedia: () => Promise.resolve({}) } : {},
    configurable: true,
  });
}

function setTouch(maxTouchPoints: number, ontouchstart: boolean) {
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: maxTouchPoints,
    configurable: true,
  });
  if (ontouchstart) {
    (window as unknown as Record<string, unknown>)["ontouchstart"] = () => {};
  } else {
    delete (window as unknown as Record<string, unknown>)["ontouchstart"];
  }
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)["ontouchstart"];
});

describe("supportsCameraScan", () => {
  it("is true with getUserMedia and an ontouchstart hook", () => {
    setGetUserMedia(true);
    setTouch(0, true);
    expect(supportsCameraScan()).toBe(true);
  });

  it("is true with getUserMedia and touch points", () => {
    setGetUserMedia(true);
    setTouch(5, false);
    expect(supportsCameraScan()).toBe(true);
  });

  it("is false without a camera API even on a touch device", () => {
    setGetUserMedia(false);
    setTouch(5, true);
    expect(supportsCameraScan()).toBe(false);
  });

  it("is false on a non-touch device (desktop)", () => {
    setGetUserMedia(true);
    setTouch(0, false);
    expect(supportsCameraScan()).toBe(false);
  });
});
