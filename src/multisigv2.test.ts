import {
  isReady,
  shutdown,
  PrivateKey,
  PublicKey,
  Field,
  Bool,
  Mina,
  MerkleMap,
  AccountUpdate,
  UInt64,
} from 'snarkyjs';
import { describe, expect, beforeEach, afterAll, it } from '@jest/globals';
import {
  MultiSigContract,
  Proposal,
  ProposalState,
  SignerState,
} from './multisigv2';
import {
  approve,
  assertBalance,
  createLocalBlockchain,
  deployMultisig,
  printBalance,
  ProveMethod,
} from './utils';
import { tic, toc } from './tictoc';

describe('multisigv2', () => {
  let zkAppInstance: MultiSigContract,
    zkAppPrivateKey: PrivateKey,
    zkAppAddress: PublicKey,
    context: {
      signersTree: MerkleMap;
      stateTree: MerkleMap;
      proveMethod: ProveMethod;
    },
    signersPk: PrivateKey[],
    signers: PublicKey[],
    account: PrivateKey;

  let numSigners = 5;

  beforeAll(async () => {
    await isReady;

    tic('Compiling Program');
    // await MultiSigProgram.compile()
    // await MultiSigContract.compile()
    toc();
  });

  beforeEach(async () => {
    await isReady;
    account = createLocalBlockchain();
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    zkAppInstance = new MultiSigContract(zkAppAddress);

    context = {
      signersTree: new MerkleMap(),
      stateTree: new MerkleMap(),
      proveMethod: {
        zkappKey: zkAppPrivateKey,
      },
    };

    signers = [];
    signersPk = [];
    for (let i = 0; i < numSigners; i++) {
      let pk = PrivateKey.random();
      signersPk.push(pk);
      signers.push(pk.toPublicKey());
      await context.signersTree.set(
        pk.toPublicKey().x,
        new SignerState({ pubkey: pk.toPublicKey(), voted: Bool(false) }).hash()
      );
    }
  });

  afterAll(async () => {
    setTimeout(shutdown, 0);
  });

  let it2 = (a: string, b: () => void) => {};

  it2('approve a transfer', async () => {
    await deployMultisig(
      zkAppInstance,
      context.signersTree,
      numSigners,
      context.stateTree,
      account,
      2,
      context.proveMethod
    );

    let proposal = new Proposal({
      amount: Mina.accountCreationFee().mul(2),
      receiver: signers[1],
    });

    let proposalState = new ProposalState({
      proposal: proposal,
      index: Field(0),
      votes: [Field(0), Field(0)],
      signerStateRoot: context.signersTree.getRoot(),
      accountCreationFeePaid: Bool(false),
    });

    expect(zkAppInstance.proposalRoot.get()).toEqual(
      context.stateTree.getRoot()
    );

    let witness = await context.stateTree.getWitness(Field(0));

    await (
      await Mina.transaction(account, () => {
        AccountUpdate.createSigned(account).send({
          to: zkAppAddress,
          amount: Mina.accountCreationFee().mul(2),
        });
      })
    )
      .sign()
      .send();

    await assertBalance(account.toPublicKey(), UInt64.from(996900000000));
    // printBalance(signers[1])
    await assertBalance(zkAppAddress, Mina.accountCreationFee().mul(2));

    // await signWithProof(proof1, proposalStateBefore, proposalState, witness, account, zkAppAddress, context.proveMethod)
    await approve(
      proposalState,
      witness,
      context.signersTree,
      signersPk[0],
      Bool(true),
      account,
      zkAppAddress,
      context.proveMethod
    );

    context.signersTree.set(
      signers[0].x,
      new SignerState({ pubkey: signers[0], voted: Bool(true) }).hash()
    );

    await assertBalance(signers[1], UInt64.from(0));
    await assertBalance(zkAppAddress, Mina.accountCreationFee());

    expect(proposalState.accountCreationFeePaid).toEqual(Bool(true));

    await approve(
      proposalState,
      witness,
      context.signersTree,
      signersPk[1],
      Bool(false),
      account,
      zkAppAddress,
      context.proveMethod
    );
    context.signersTree.set(
      signers[1].x,
      new SignerState({ pubkey: signers[1], voted: Bool(true) }).hash()
    );

    await assertBalance(signers[1], UInt64.from(0));
    await assertBalance(zkAppAddress, Mina.accountCreationFee());

    await approve(
      proposalState,
      witness,
      context.signersTree,
      signersPk[2],
      Bool(true),
      account,
      zkAppAddress,
      context.proveMethod
    );
    context.signersTree.set(
      signers[2].x,
      new SignerState({ pubkey: signers[2], voted: Bool(true) }).hash()
    );

    await assertBalance(signers[1], Mina.accountCreationFee());
    await assertBalance(zkAppAddress, UInt64.from(0));
  });

  it('approve a transfer with initialized account', async () => {
    await deployMultisig(
      zkAppInstance,
      context.signersTree,
      numSigners,
      context.stateTree,
      account,
      1,
      context.proveMethod
    );

    let proposal = new Proposal({
      amount: Mina.accountCreationFee().mul(2),
      receiver: signers[2],
    });

    let proposalState = new ProposalState({
      proposal: proposal,
      index: Field(0),
      votes: [Field(0), Field(0)],
      signerStateRoot: context.signersTree.getRoot(),
      accountCreationFeePaid: Bool(false),
    });

    expect(zkAppInstance.proposalRoot.get()).toEqual(
      context.stateTree.getRoot()
    );

    let witness = await context.stateTree.getWitness(Field(0));

    let send = async (
      acc: PrivateKey,
      to: PublicKey,
      amount: UInt64,
      create: boolean = false
    ) => {
      await (
        await Mina.transaction(acc, () => {
          if (create) {
            AccountUpdate.fundNewAccount(acc);
          }
          AccountUpdate.createSigned(acc).send({
            to: to,
            amount: amount,
          });
        })
      )
        .sign()
        .send();
    };

    await send(account, zkAppAddress, Mina.accountCreationFee().mul(2));
    await send(account, signers[2], UInt64.from(1), true);

    await assertBalance(
      account.toPublicKey(),
      UInt64.from(996900000000).sub(Mina.accountCreationFee()).sub(1)
    );
    await assertBalance(zkAppAddress, Mina.accountCreationFee().mul(2));

    // await signWithProof(proof1, proposalStateBefore, proposalState, witness, account, zkAppAddress, context.proveMethod)
    await approve(
      proposalState,
      witness,
      context.signersTree,
      signersPk[0],
      Bool(true),
      account,
      zkAppAddress,
      context.proveMethod,
      false
    );

    context.signersTree.set(
      signers[0].x,
      new SignerState({ pubkey: signers[0], voted: Bool(true) }).hash()
    );

    expect(proposalState.accountCreationFeePaid).toEqual(Bool(false));
    context.stateTree.set(Field(0), proposalState.hash());

    // expect(context.stateTree.getRoot()).toEqual(zkAppInstance.proposalRoot.get()) Proposal has been paid out

    // expect(proposalState.hash()).toEqual(context.stateTree.get(Field(0)));

    await assertBalance(signers[2], Mina.accountCreationFee().mul(2).add(1));
    await assertBalance(zkAppAddress, UInt64.from(0));
  });

  // it('rejects an incorrect solution', async () => {
  //   await deploy(zkAppInstance, zkAppPrivateKey, sudoku, account);

  //   let solution = solveSudoku(sudoku);
  //   if (solution === undefined) throw Error('cannot happen');

  //   let noSolution = cloneSudoku(solution);
  //   noSolution[0][0] = (noSolution[0][0] % 9) + 1;

  //   expect.assertions(1);
  //   try {
  //     await submitSolution(
  //       sudoku,
  //       noSolution,
  //       account,
  //       zkAppAddress,
  //       zkAppPrivateKey
  //     );
  //   } catch (e) {
  //     // A row, column  or 3x3 square will not have full range 1-9
  //     // This will cause an assert.
  //   }

  //   let { isSolved } = await getZkAppState(zkAppInstance);
  //   expect(isSolved).toBe(false);
  // });
});
