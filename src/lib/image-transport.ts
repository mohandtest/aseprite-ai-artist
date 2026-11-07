import { randomUUID } from "node:crypto";
import type { AsepriteLink, CallOptions } from "../bridge/link.js";
import { LiveError, missingFields } from "./protocol.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export interface CapturedImage<T> {
  meta: T;
  image: { data: string; mimeType: "image/png" };
}

/** File paths cannot cross a Windows-editor / WSL-server boundary. Only bytes do. */
export async function captureImage<T extends object>(
  live: AsepriteLink,
  command: string,
  args: Record<string, unknown>,
  options: CallOptions = {},
): Promise<CapturedImage<T>> {
  let result: CapturedImage<T>;
  try {
    result = await live.call<CapturedImage<T>>(
      "image.capture",
      { command, args, token: randomUUID() },
      { expect: ["meta", "image"], timeoutMs: options.timeoutMs },
    );
  } catch (err) {
    if (err instanceof LiveError && err.code === "unsupported_command") {
      throw new LiveError(
        "unsupported_command",
        "The installed extension cannot transfer preview images over the bridge.",
        {
          remediation:
            "Reinstall the extension from this local checkout with install-extension, restart Aseprite, and restart the MCP server.",
          doNotFallBackToDisk: true,
        },
      );
    }
    throw err;
  }
  const missing = missingFields(result.meta, options.expect ?? []);
  if (missing.length) throw new LiveError("aseprite_error", `Image metadata is missing: ${missing.join(", ")}.`);
  const image = result.image;
  const padding =
    typeof image?.data === "string" ? (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0) : 0;
  if (
    !image ||
    image.mimeType !== "image/png" ||
    typeof image.data !== "string" ||
    image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    image.data.length % 4 !== 0 ||
    /[^A-Za-z0-9+/]/.test(image.data.slice(0, image.data.length - padding))
  ) {
    throw new LiveError("aseprite_error", "Aseprite returned an invalid or oversized PNG payload.");
  }
  const decoded = Buffer.from(image.data, "base64");
  if (decoded.length > MAX_IMAGE_BYTES || !decoded.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new LiveError("aseprite_error", "Aseprite returned an invalid PNG signature or oversized image.");
  }
  return result;
}
