import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "dist/index.js",
  external: [
    // AWS SDK v3 is available in the Lambda runtime
    "@aws-sdk/*",
  ],
  sourcemap: true,
  minify: false,
});
