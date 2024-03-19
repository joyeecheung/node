// a.mjs
try {
  await import("./b.mjs");
  console.log("Dynamic 1 didn't fail")
} catch (err) {
  console.log(err);
}

console.log('---');

try {
  await import("./d.mjs");
  console.log("Dynamic 2 didn't fail")
} catch (err) {
  console.log(err);
}
