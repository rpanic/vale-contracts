// helpers
import {
  AccountUpdate,
  Bool, fetchAccount,
  Field,
  isReady,
  MerkleMap,
  MerkleMapWitness,
  Mina,
  PrivateKey,
  PublicKey,
  Signature,
  UInt64,
} from 'snarkyjs';
import fs from 'fs';
import { MultiSigContract, ProposalState, SignerState } from './multisigv2';
import readline from 'readline';
import util from 'util';
import {tic, toc} from "./tictoc";

export function createLocalBlockchain(): PrivateKey {
  let Local = Mina.LocalBlockchain({ accountCreationFee: 1e9, proofsEnabled: true });
  Mina.setActiveInstance(Local);

  const account = Local.testAccounts[0].privateKey;
  return account;
}

export function createBerkeley(): PrivateKey {
  let berkeley = Mina.Network(
    'https://proxy.berkeley.minaexplorer.com/graphql'
  );

  Mina.setActiveInstance(berkeley);

  let data = JSON.parse(
    fs.readFileSync('keys/wallet.json', { encoding: 'utf-8' })
  );
  let pk = PrivateKey.fromBase58(data['privateKey'])!!;
  return pk;
}

export interface ProveMethod {
  verificationKey?: {
    data: string;
    hash: Field | string;
  };
  zkappKey?: PrivateKey;
}

export async function deployMultisig(
  zkAppInstance: MultiSigContract,
  signers: MerkleMap,
  signersLength: number,
  state: MerkleMap,
  account: PrivateKey,
  k: number,
  proveMethod: ProveMethod
): Promise<string> {

  let acc = await fetchAccount({publicKey: account.toPublicKey()})
  let nonce = acc.account!.nonce

  let tx = await Mina.transaction(
      { feePayerKey: account, fee: 0.1 * 1e9 },
      () => {
        AccountUpdate.fundNewAccount(account);

        zkAppInstance.setup(
          signers.getRoot(),
          state.getRoot(),
          Field(signersLength),
          Field(k)
        );

        zkAppInstance.requireSignature()

        zkAppInstance.deploy(proveMethod);

        console.log('Init with k = ', k);

      if(proveMethod.zkappKey){
        console.log("require sig")
        zkAppInstance.requireSignature();
      }
    }
  );
  if (proveMethod.verificationKey) {
    tic("Proving deploy...")
    await tx.prove();
    toc()
  }
  tx.sign(proveMethod.zkappKey ? [proveMethod.zkappKey] : []);
  // console.log(tx.toJSON())
  let txId = await tx.send();

  return txId.hash();
}

export async function secondDeployPart(
    zkAppInstance: MultiSigContract,
    signers: MerkleMap,
    signersLength: number,
    state: MerkleMap,
    account: PrivateKey,
    k: number,
    proveMethod: ProveMethod
) : Promise<string> {

  let acc = await fetchAccount({publicKey: account.toPublicKey()})

  //Send 2nd tx for setup
  if(proveMethod.verificationKey){
    let tx = await Mina.transaction({ feePayerKey: account, fee: 0.01 * 1e9 }, () => {
      zkAppInstance.setup(signers.getRoot(), state.getRoot(), Field(signersLength), Field(k));
    })
    tic("Proving second depoy part...")
    await tx.prove()
    toc()
    tx.sign()
    let txId = await tx.send()
    return txId.hash()
  }
  return ""
}

export async function printBalance(key: PublicKey) {
  let x = await Mina.getBalance(key);
  console.log(key.toBase58() + ': ' + x.toString());
}

export async function assertBalance(key: PublicKey, balance: UInt64) {
  let x = await Mina.getBalance(key);
  expect(x).toEqual(balance);
}

// export async function init(
//     account: PrivateKey,
//     zkAppInstance: MultiSigZkApp,
//     zkAppPrivateKey: PrivateKey,
//     signers: PublicKey[],
// ) {
//     let tx = await Mina.transaction({ feePayerKey: account, fee: 100000000 }, () => {
//         zkAppInstance.init(SignerList.constructFromSigners(signers), Field.fromNumber(Math.ceil(signers.length / 2)), Field.fromNumber(signers.length));
//     })
//     await tx.prove()
//     await tx.send().wait()
// }

async function sendTo(sender: PrivateKey, receiver: PublicKey) {
  let tx = await Mina.transaction(sender, () => {
    AccountUpdate.createSigned(sender).send({
      to: receiver,
      amount: UInt64.from(1000),
    });
  });
  await tx.send();
}

async function fundNewAccount(payer: PrivateKey, account: PublicKey) {
  let tx = await Mina.transaction(payer, () => {
    AccountUpdate.createSigned(payer).send({
      to: account,
      amount: UInt64.from(1),
    });
    AccountUpdate.fundNewAccount(payer);
  });
  await tx.send();
}

export async function approve(
  proposalState: ProposalState,
  proposalWitness: MerkleMapWitness,
  signerState: MerkleMap,
  signer: PrivateKey,
  vote: Bool,
  account: PrivateKey,
  zkAppAddress: PublicKey,
  proveMethod: ProveMethod,
  newAccount: boolean = true
) {
  let signature = Signature.create(signer, [
    proposalState.hash(),
    vote.toField(),
  ]);

  let signerWitness = await signerState.getWitness(signer.toPublicKey().x);

  let tx = await Mina.transaction(account, () => {
    let zkApp = new MultiSigContract(zkAppAddress);

    zkApp.doApproveSignature(
      signer.toPublicKey(),
      signature,
      vote,
      proposalState.deepCopy(),
      proposalWitness,
      signerWitness
    );

    if (proveMethod.zkappKey && !proveMethod.verificationKey) {
      zkApp.requireSignature();
    }
  });
  try {

    if (proveMethod.verificationKey) {
      tic("Proving approve...")
      await tx.prove();
      toc()
    }
    tx.sign(proveMethod.zkappKey && !proveMethod.verificationKey ? [proveMethod.zkappKey] : []);
    await tx.send();

    if (
      proposalState.accountCreationFeePaid.toBoolean() === false &&
      newAccount
    ) {
      proposalState.accountCreationFeePaid = Bool(true);
    }
    let i = vote.toBoolean() ? 0 : 1;
    proposalState.votes[i] = proposalState.votes[i].add(1);

    signerState.set(
      signer.toPublicKey().x,
      new SignerState({
        pubkey: signer.toPublicKey(),
        voted: Bool(true),
      }).hash()
    );

    proposalState.signerStateRoot = signerState.getRoot();

    return true;
  } catch (err) {
    console.log(err);
    return false;
  }
}

//MerkleMap

export class MerkleMapUtils {
  static get EMPTY_VALUE() {
    return Field(0);
  }

  static checkMembership(
    witness: MerkleMapWitness,
    root: Field,
    key: Field,
    value: Field
  ): Bool {
    let r = witness.computeRootAndKey(value);
    return r[0].equals(root)
        .and(
          r[1].equals(key)
        )
  }

  static computeRoot(
    witness: MerkleMapWitness,
    key: Field,
    value: Field
  ): Field {
    return witness.computeRootAndKey(value)[0];
  }
}

export async function openConsole() {
  let rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = util.promisify(rl.question).bind(rl);

  while (true) {
    let s = await question('> ');
    if ((s as any) === 'exit') {
      break;
    }
    console.log(s);
    console.log(eval(s as any));
  }
}
