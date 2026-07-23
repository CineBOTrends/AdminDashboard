// Run locally with Node to generate the values you paste into Cloudflare
// Pages -> Settings -> Environment variables (as encrypted secrets).
//
//   node scripts/hash-password.mjs
//
// Nothing here is sent anywhere — it only prints values for you to copy.

import crypto from "node:crypto";
import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question("Admin username: ", (username) => {
  rl.question("Admin password: ", (password) => {
    rl.close();

    const salt = crypto.randomBytes(16);
    const iterations = 100000;
    const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");
    const sessionSecret = crypto.randomBytes(32).toString("hex");

    console.log("\nSet these as Production secrets in the Cloudflare Pages project settings:\n");
    console.log("ADMIN_USERNAME=" + username);
    console.log("ADMIN_PASSWORD_HASH=" + hash.toString("hex"));
    console.log("PASSWORD_SALT=" + salt.toString("hex"));
    console.log("PASSWORD_ITERATIONS=" + iterations);
    console.log("SESSION_SECRET=" + sessionSecret);
    console.log("\nThe plain password is never stored anywhere — only the hash above.");
  });
});
