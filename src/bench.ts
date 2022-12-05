import {
  Bool,
  Circuit,
  Experimental,
  Field,
  MerkleMap,
  MerkleMapWitness,
  Mina,
  PrivateKey,
  Proof,
  PublicKey,
  SelfProof,
  Struct,
} from 'snarkyjs';
import { MultiSigContract, ProposalState, SignerState } from './multisigv2';
import { tic, toc } from './tictoc';
import { ProveMethod } from './utils';

export class MultiSigState extends Struct({
  toProposalHash: Field,
  fromProposalHash: Field,
}) {}

export { MultiSigProgram };

let MultiSigProgram = Experimental.ZkProgram({
  publicInput: MultiSigState,

  methods: {
    approve: {
      privateInputs: [PrivateKey, ProposalState, Bool, MerkleMapWitness],
      method(
        publicInput: MultiSigState,
        pk: PrivateKey,
        proposalState: ProposalState,
        vote: Bool,
        signerWitness: MerkleMapWitness
      ) {
        publicInput.fromProposalHash.assertEquals(
          proposalState.hash(),
          'FromProposal not right'
        );

        let pub = pk.toPublicKey();

        let signerState = new SignerState({ pubkey: pub, voted: Bool(false) });

        let r = signerWitness.computeRootAndKey(signerState.hash());
        r[1].assertEquals(pub.x, 'Key not right');
        r[0].assertEquals(
          proposalState.signerStateRoot,
          'Signer already signed or not in signer list'
        );
        // ProvableSMTUtils.checkMembership(signerWitness, proposalState.signerStateRoot, pub.x, signerState.hash(), treeOptions)
        //     .assertTrue("Signer already signed or not in signer list")

        signerState.voted = Bool(true);
        // proposalState.signerStateRoot = ProvableSMTUtils.computeRoot(signerWitness.sideNodes, pub.x, signerState.hash(), treeOptions)
        proposalState.signerStateRoot = signerWitness.computeRootAndKey(
          signerState.hash()
        )[0];

        //Change vote
        proposalState.votes[0] = proposalState.votes[0].add(
          Circuit.if(vote, Field(1), Field(0))
        );

        proposalState.votes[1] = proposalState.votes[1].add(
          Circuit.if(vote, Field(0), Field(1))
        );

        publicInput.toProposalHash.assertEquals(
          proposalState.hash(),
          'ToProposal not satisfied'
        );
      },
    },

    merge: {
      privateInputs: [SelfProof, SelfProof],
      method(
        publicInput: MultiSigState,
        proof1: SelfProof<MultiSigState>,
        proof2: SelfProof<MultiSigState>
      ) {
        proof1.verify();
        proof2.verify();

        publicInput.fromProposalHash.assertEquals(
          proof1.publicInput.fromProposalHash,
          'Merge 1'
        );
        proof1.publicInput.toProposalHash.assertEquals(
          proof2.publicInput.fromProposalHash,
          'Merge 2'
        );
        proof2.publicInput.toProposalHash.assertEquals(
          publicInput.toProposalHash,
          'Merge 3'
        );
      },
    },
  },
});

export class MultiSigProof extends Proof<MultiSigState> {
  static publicInputType = MultiSigState;
  static tag = () => MultiSigProgram;
}

//UTILS

export async function generateProof(
  signerState: MerkleMap,
  proposalState: ProposalState,
  signer: PrivateKey,
  vote: boolean
): Promise<SelfProof<MultiSigState>> {
  tic('Generating proof...');

  let witness = await signerState.getWitness(signer.toPublicKey().x);

  let fromProposal = new ProposalState(proposalState);
  let state = new MultiSigState({
    fromProposalHash: proposalState.hash(),
    toProposalHash: Field(0),
  });

  proposalState.votes[vote ? 0 : 1] = proposalState.votes[vote ? 0 : 1].add(
    Field(1)
  );
  await signerState.set(
    signer.toPublicKey().x,
    new SignerState({ pubkey: signer.toPublicKey(), voted: Bool(true) }).hash()
  );
  proposalState.signerStateRoot = signerState.getRoot();
  state.toProposalHash = proposalState.hash();

  let proof = MultiSigProgram.approve(
    state,
    signer,
    fromProposal,
    Bool(vote),
    witness
  );

  toc();

  return proof;
}

export async function signWithProof(
  proof: MultiSigProof,
  proposalStateBefore: ProposalState,
  proposalState: ProposalState,
  proposalWitness: MerkleMapWitness,
  account: PrivateKey,
  zkAppAddress: PublicKey,
  proveMethod: ProveMethod
) {
  let tx = await Mina.transaction(account, () => {
    let zkApp = new MultiSigContract(zkAppAddress);

    // zkApp.approveWithProof(proof, proposalState, proposalStateBefore, proposalWitness)

    if (proveMethod.zkappKey) {
      zkApp.requireSignature();
    }
  });
  try {
    if (proveMethod.verificationKey) {
      await tx.prove();
    }
    tx.sign();
    await tx.send();
    return true;
  } catch (err) {
    console.log(err);
    return false;
  }
}

// @method approveWithProof(proof: MultiSigProof, toProposalState: ProposalState, fromProposalState: ProposalState, proposalWitness: SparseMerkleProof) {
//
//     this.signerThreshold.assertEquals(this.signerThreshold.get());
//     this.numSigners.assertEquals(this.numSigners.get());
//     this.signerRoot.assertEquals(this.signerRoot.get());
//     this.proposalRoot.assertEquals(this.proposalRoot.get());
//
//     // fromProposalState.index.assertEquals(toProposalState.index)
//
//     //Check that proposal is either new and not in the tree or is in the tree
//     let proposalTreeValue = Circuit.if(fromProposalState.caBeNew(), EMPTY_VALUE, fromProposalState.hash())
//
//     ProvableSMTUtils.checkMembership(proposalWitness, this.proposalRoot.get(), fromProposalState.index, proposalTreeValue, treeOptions)
//         .assertTrue("State tree membership not right")
//
//     let signerTreeRoot = Circuit.if(fromProposalState.caBeNew(), this.signerRoot.get(), fromProposalState.signerStateRoot)
//     fromProposalState.signerStateRoot.assertEquals(signerTreeRoot)
//
//     proof.publicInput.fromProposalHash.assertEquals(fromProposalState.hash())
//     proof.publicInput.toProposalHash.assertEquals(toProposalState.hash())
//
//     proof.verify()
//
//     let votesFor = toProposalState.votes[0]
//     let votesAgainst = toProposalState.votes[1]
//     let votesReached = votesFor.gte(this.signerThreshold.get())
//
//     let amount = Circuit.if(votesReached, toProposalState.proposal.amount, UInt64.from(0))
//
//     //pay account creation fee if necessary
//     let accountUpdate = AccountUpdate.create(toProposalState.proposal.receiver)
//     let isNew = accountUpdate.account.isNew.get()
//     accountUpdate.account.isNew.assertEquals(isNew)
//
//     amount = amount.sub(Circuit.if(
//         isNew,
//         Mina.accountCreationFee(),
//         UInt64.from(0)
//     ))
//     this.balance.subInPlace(Circuit.if(isNew, Mina.accountCreationFee(), UInt64.from(0)))
//
//     this.self.send({to: toProposalState.proposal.receiver, amount})
//
//     let newProposalTreeValue = Circuit.if(
//         votesReached.or(
//             votesAgainst.gte(this.numSigners.get().sub(this.signerThreshold.get()))
//         ),
//         EMPTY_VALUE,
//         toProposalState.hash())
//
//     let newRoot = ProvableSMTUtils.computeRoot(proposalWitness.sideNodes, fromProposalState.index, newProposalTreeValue)
//
//     this.proposalRoot.set(newRoot)
//
// }
