#!/usr/bin/env node

const ethers = require("ethers");
const { EVM } = require("evm");
const axios = require("axios");
const fs = require("fs");
const cliProgress = require('cli-progress');
const manifest = require('./package.json');

const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

const ADDRESS = process.argv[2];
const JSONRPC = process.argv[3];
const NAME = process.argv[4];

if (!ADDRESS || !ethers.utils.isAddress(ADDRESS)) {
  console.error(`Invalid address. Usage: sigext <ADDRESS> <JSONRPC> <NAME>`);
  process.exit(1);
}

if (!JSONRPC) {
  console.error(
    `Invalid json rpc url. Usage: sigext <ADDRESS> <JSONRPC> <NAME>`
  );
  process.exit(1);
}

if (!NAME) {
  console.log(`Missing name. Usage: sigext <ADDRESS> <JSONRPC> <NAME>`);
  process.exit(1);
}

const provider = new ethers.providers.JsonRpcProvider(JSONRPC);

console.log(`sigext v${manifest.version}`);

const main = async () => {
  let code;
  try {
    console.log("Retrieving code ...");
    code = await provider.getCode(ADDRESS);
    console.log("Retrieved code");
  } catch (e) {
    console.error(`Unable to retrieve code.`);
    console.error(e);
    process.exit();
  }

  if (code === "0x") {
    console.error(`Address is not smart contract`);
    process.exit(1);
  }

  const evm = new EVM(code);
  const opcodes = evm.getOpcodes();
  let potentialMethodSignatures = [];
  for (let idx = 0; idx + 3 < opcodes.length; ++idx) {
    if (opcodes[idx].name === "PUSH4" && opcodes[idx + 3].name === "JUMPI") {
      potentialMethodSignatures.push(
        "0x" + opcodes[idx].pushData.toString("hex").toLowerCase()
      );
    }
  }
  potentialMethodSignatures = potentialMethodSignatures.filter(
    (v, idx, arr) => arr.indexOf(v) === idx
  );
  const methods = [];
  const noMatch = [];
  let idx = 0;
  console.log()
  console.log(`Searching for matches`);
  bar.start(potentialMethodSignatures.length, 0);
  for (const potentialMethodSignature of potentialMethodSignatures) {
    bar.update(idx + 1);
    ++idx;
    const res = await axios.get(
      `https://www.4byte.directory/api/v1/signatures/?hex_signature=${potentialMethodSignature}`
    );
    if (res.data?.results?.length) {
      for (const resu of res.data.results) {
        methods.push({
          signature: resu.hex_signature,
          method: resu.text_signature,
        });
      }
    } else {
      noMatch.push(potentialMethodSignature);
    }
    await new Promise((ok) => setTimeout(ok, 200));
  }
  bar.stop();
  console.log();
  if (methods.length) {
    console.log(`Signatures with possible identifications`);
    for (const method of methods) {
      console.log(`[${method.signature}] => ${method.method}`);
    }
  } else {
    console.error(`No methods identified`);
    process.exit(1);
  }
  console.log();
  if (noMatch.length) {
    console.log(`Signatures without identification`);
    for (const method of noMatch) {
      console.log(`[${method}]`);
    }
  }
  const readOnlyAbi = [];
  const payableOnlyAbi = [];
  const nonPayableOnlyAbi = [];
  for (const method of methods) {
    const name = method.method.slice(0, method.method.indexOf("("));
    const argTypes = method.method
      .slice(method.method.indexOf("(") + 1, -1)
      .split(",")
      .filter((v) => v !== "");
    readOnlyAbi.push({
      inputs: argTypes.map((v, idx) => ({
        internalType: v,
        name: `arg_${idx + 1}`,
        type: v,
      })),
      name,
      type: "function",
      stateMutability: "view",
      outputs: [],
    });
    payableOnlyAbi.push({
      inputs: argTypes.map((v, idx) => ({
        internalType: v,
        name: `arg_${idx + 1}`,
        type: v,
      })),
      name,
      type: "function",
      stateMutability: "payable",
      outputs: [],
    });
    nonPayableOnlyAbi.push({
      inputs: argTypes.map((v, idx) => ({
        internalType: v,
        name: `arg_${idx + 1}`,
        type: v,
      })),
      name,
      type: "function",
      stateMutability: "nonpayable",
      outputs: [],
    });
  }
  fs.writeFileSync(
    `${NAME}.abi.json`,
    JSON.stringify(
      readOnlyAbi.concat(payableOnlyAbi).concat(nonPayableOnlyAbi),
      null,
      4
    )
  );
  console.log();
  console.log(`Written abi to ${NAME}.abi.json`);
};

main()
.catch((e) => {
  console.error(e);
  bar.stop();
})
