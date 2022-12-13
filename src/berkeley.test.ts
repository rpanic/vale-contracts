import {
  isReady,
  shutdown,
  PrivateKey,
  Mina,
  AccountUpdate,
  Circuit,
  PublicKey, UInt64, Field, Bool,
} from 'snarkyjs';
import { describe, expect, beforeEach, afterAll, it } from '@jest/globals';
import { createBerkeley } from './utils';
import { tic, toc } from './tictoc';
import { fetchEvents } from 'snarkyjs/dist/web/lib/mina';
import {Proposal, ProposalState} from "./multisigv2";

describe('multisigv2 berkeley', () => {
  let account: PrivateKey;

  beforeAll(async () => {
    await isReady;

    tic('Compiling Program');
    // await MultiSigProgram.compile()
    // await MultiSigContract.compile()
    toc();
  });

  beforeEach(async () => {
    await isReady;
    // account = createBerkeley();
  });

  afterAll(async () => {
    setTimeout(shutdown, 0);
  });

  it('test isNew', async () => {

    let p = new Proposal({amount: UInt64.from(2), receiver: PublicKey.empty()})
    let p2 = new ProposalState({proposal: p, signerStateRoot: Field(1), accountCreationFeePaid: Bool(true), votes: [Field(0), Field(0)], index: Field(15)})

    let o = ProposalState.toJSON(p2)
    console.log(o)
    let p3 = ProposalState.fromJSON(o)
    console.log(p3)

    // let events = fetchEvents(PublicKey.fromBase58("B62qpNUmSgz8WRvLh57HUaEf9NWLkFQHZLhUDX9UCAiWEYpVB5KtZq6"), )
    // let tx = await Mina.transaction(account, () => {
    //     let au = AccountUpdate.create(account.toPublicKey())
    //     au.account.isNew.assertEquals(au.account.isNew.get());
    //     Circuit.log(au.account.isNew.get())
    // })
    //
    // tx.sign()
  });
});
