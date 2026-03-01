function isAddress(x) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(x || "").trim());
}

async function resolve(input) {
  const x = String(input || "").trim();
  if (isAddress(x)) return x;
  throw new Error("Resolver: input is not a valid 0x address yet. Pass CA for now.");
}

module.exports = { resolve };
