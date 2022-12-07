import {
  isReady,
  shutdown,
  PrivateKey,
  Mina,
  AccountUpdate,
  Circuit,
  PublicKey,
} from 'snarkyjs';
import { describe, expect, beforeEach, afterAll, it } from '@jest/globals';
import { createBerkeley } from './utils';
import { tic, toc } from './tictoc';
import { fetchEvents } from 'snarkyjs/dist/web/lib/mina';

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
    account = createBerkeley();
  });

  afterAll(async () => {
    setTimeout(shutdown, 0);
  });

  it('test isNew', async () => {
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
