/**
 * A zkSNARK proof (without signals) generated by snarkJS `fullProve`
 */
export interface SnarkJSProof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
}

/**
 * A zkSNARK proof and corresponding public signals generated by snarkJS
 * `fullProve`
 */
export interface SnarkJSProofAndSignals {
  proof: SnarkJSProof;
  publicSignals: string[];
}

export interface InitSnarkInput {
  x: string;
  y: string;
  blockhash: string;
  possibleHashes: string[];
  possibleHashesHash: string;
  salt: string;
  saltUpperBound: string;
  gridUpperBound: string;
  commitment: string;
}

export type ContractCallArgs = [
  [string, string], // proofA
  [
    // proofB
    [string, string],
    [string, string]
  ],
  [string, string], // proofC
  [
    string, // hashed whitelist key
    string // recipient address
  ]
];

/**
 * Method for converting the output of snarkJS `fullProve` into args that can be
 * passed into DarkForest smart contract functions which perform zk proof
 * verification.
 *
 * @param snarkProof the SNARK proof
 * @param publicSignals the circuit's public signals (i.e. output signals and
 * public input signals)
 */
export function buildContractCallArgs(
  snarkProof: SnarkJSProof,
  publicSignals: string[]
): ContractCallArgs {
  // the object returned by genZKSnarkProof needs to be massaged into a set of parameters the verifying contract
  // will accept
  return [
    snarkProof.pi_a.slice(0, 2), // pi_a
    // genZKSnarkProof reverses values in the inner arrays of pi_b
    [snarkProof.pi_b[0].slice(0).reverse(), snarkProof.pi_b[1].slice(0).reverse()], // pi_b
    snarkProof.pi_c.slice(0, 2), // pi_c
    publicSignals, // input
  ] as ContractCallArgs;
}
