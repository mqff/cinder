const path = require("node:path");
const { execFileSync } = require("node:child_process");

// electron-builder skips signing when mac.identity is null, which leaves the
// bundle with only Electron's original linker signature. That signature no
// longer matches the packaged app, so Apple silicon Macs report the app as
// "damaged". An ad-hoc signature over the whole bundle fixes that.
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const entitlements = path.join(__dirname, "..", "build", "entitlements.mac.plist");
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", "--entitlements", entitlements, app], {
    stdio: "inherit"
  });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
};
