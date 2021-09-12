#!/usr/bin/env node

const ethers = require("ethers");
const { EVM } = require("evm");
const axios = require("axios");
const fs = require("fs");

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

const main = async () => {
  let code;
  try {
    code = await provider.getCode(ADDRESS);
  } catch (e) {
    console.error(`Unable to retrieve code.`);
    console.error(e);
    process.exit();
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
  for (const potentialMethodSignature of potentialMethodSignatures) {
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
    }
    await new Promise((ok) => setTimeout(ok, 200));
  }
  for (const method of methods) {
    console.log(`[${method.signature}] => ${method.method}`);
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
  fs.writeFileSync(`${NAME}.abi.json`, JSON.stringify(readOnlyAbi.concat(payableOnlyAbi).concat(nonPayableOnlyAbi), null, 4));
  console.log(`Written abi to ${NAME}.abi.json`);
};

main();
