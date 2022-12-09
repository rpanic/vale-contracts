import {
  AccountUpdate,
  Bool,
  Circuit,
  DeployArgs,
  Field,
  MerkleMapWitness,
  method,
  Mina,
  Poseidon,
  PublicKey,
  Signature,
  SmartContract,
  State,
  state,
  Struct,
  UInt64,
  Permissions,
} from 'snarkyjs';
import { MerkleMapUtils } from './utils';

interface Fieldable {
  toFields(): Field[];
}

export function structArrayToFields(...args: Fieldable[]): Field[] {
  return args.map((x) => x.toFields()).reduce((a, b) => a.concat(b), []);
}

export class Proposal extends Struct({
  amount: UInt64,
  receiver: PublicKey,
}) {
  hash(): Field {
    return Poseidon.hash(structArrayToFields(this.amount, this.receiver));
  }
}

export class SignerState extends Struct({
  pubkey: PublicKey,
  voted: Bool,
}) {
  hash(): Field {
    return Poseidon.hash(structArrayToFields(this.pubkey, this.voted));
  }
}

export class ProposalState extends Struct({
  proposal: Proposal,
  index: Field,
  votes: [Field, Field],
  signerStateRoot: Field,
  accountCreationFeePaid: Bool,
}) {
  hash() {
    return Poseidon.hash(
      structArrayToFields(
        new Proposal(this.proposal).hash(),
        this.index,
        ...this.votes,
        this.signerStateRoot,
        this.accountCreationFeePaid.toField()
      )
    );
  }

  caBeNew(): Bool {
    return this.votes[0].equals(Field(0)).and(this.votes[1].equals(Field(0)));
  }

  deepCopy(): ProposalState {
    return new ProposalState({
      proposal: this.proposal,
      index: this.index,
      votes: [this.votes[0], this.votes[1]],
      signerStateRoot: this.signerStateRoot,
      accountCreationFeePaid: this.accountCreationFeePaid,
    });
  }
}

export class VotedEvent extends Struct({
  signer: PublicKey,
  vote: Bool,
  proposal: Proposal,
  index: Field,
}) {}

export class InitEvent extends Struct({
  numSigners: Field,
  k: Field,
}) {}

export class MultiSigContract extends SmartContract {
  @state(Field) signerRoot = State<Field>();
  @state(Field) proposalRoot = State<Field>();
  @state(Field) numSigners = State<Field>();
  @state(Field) signerThreshold = State<Field>();

  events = {
    init: InitEvent,
    voted: VotedEvent,
  };

  @method setup(
    signerRoot: Field,
    proposalRoot: Field,
    numSigners: Field,
    threshold: Field
  ) {
    this.signerRoot.assertEquals(Field(0));
    this.proposalRoot.assertEquals(Field(0));
    this.signerThreshold.assertEquals(Field(0));
    this.numSigners.assertEquals(Field(0));

    this.signerRoot.set(signerRoot);
    this.signerThreshold.set(threshold);
    this.numSigners.set(numSigners);
    this.proposalRoot.set(proposalRoot);

    this.emitEvent(
      'init',
      new InitEvent({
        numSigners: numSigners,
        k: threshold,
      })
    );
  }

  deploy(args: DeployArgs) {
    super.deploy(args);
    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
      editSequenceState: Permissions.proofOrSignature(),
      incrementNonce: Permissions.proofOrSignature(),
      setVerificationKey: Permissions.none(),
      setPermissions: Permissions.proofOrSignature(),
    });
    this.signerRoot.set(Field(0));
  }

  init() {
    super.init();
    // this.signerThreshold.set(Field(0));
    // this.numSigners.set(Field(0))
    // this.proposalRoot.set(Field(0))
  }

  // @method approveSignatureBatch(params: ){
  //
  // }

  @method doApproveSignature(
    signer: PublicKey,
    signature: Signature,
    vote: Bool,
    _proposalState: ProposalState,
    proposalWitness: MerkleMapWitness,
    signerWitness: MerkleMapWitness
  ) {
    this.signerThreshold.assertEquals(this.signerThreshold.get());
    this.numSigners.assertEquals(this.numSigners.get());
    this.signerRoot.assertEquals(this.signerRoot.get());
    this.proposalRoot.assertEquals(this.proposalRoot.get());

    // fromProposalState.index.assertEquals(toProposalState.index)

    let proposalState = _proposalState.deepCopy();

    //Check that proposal is either new and not in the tree or is in the tree
    let proposalTreeValue = Circuit.if(
      proposalState.caBeNew(),
      MerkleMapUtils.EMPTY_VALUE,
      proposalState.hash()
    );

    MerkleMapUtils.checkMembership(
      proposalWitness,
      this.proposalRoot.get(),
      proposalState.index,
      proposalTreeValue
    ).assertTrue('State tree membership not right');

    let signerTreeRoot = Circuit.if(
      proposalState.caBeNew(),
      this.signerRoot.get(),
      proposalState.signerStateRoot
    );
    proposalState.signerStateRoot.assertEquals(signerTreeRoot);

    //Program
    signature
      .verify(signer, [proposalState.hash(), vote.toField()])
      .assertTrue('Signature not valid');

    let signerState = new SignerState({ pubkey: signer, voted: Bool(false) });

    MerkleMapUtils.checkMembership(
      signerWitness,
      proposalState.signerStateRoot,
      signer.x,
      signerState.hash()
    ).assertTrue('Signer already signed or not in signer list');

    signerState.voted = Bool(true);
    proposalState.signerStateRoot = MerkleMapUtils.computeRoot(
      signerWitness,
      signer.x,
      signerState.hash()
    );

    //Change vote
    proposalState.votes[0] = proposalState.votes[0].add(
      Circuit.if(vote, Field(1), Field(0))
    );

    proposalState.votes[1] = proposalState.votes[1].add(
      Circuit.if(vote, Field(0), Field(1))
    );

    // -- program

    let votesFor = proposalState.votes[0];
    let votesAgainst = proposalState.votes[1];
    let votesReached = votesFor.gte(this.signerThreshold.get());

    //pay account creation fee if necessary
    let accountUpdate = AccountUpdate.create(proposalState.proposal.receiver);
    let isNew = accountUpdate.account.isNew.get();
    accountUpdate.account.isNew.assertEquals(isNew);

    Circuit.log('isNew', isNew);

    let feesPayedNow = Circuit.if(
      isNew,
      Mina.accountCreationFee(),
      UInt64.from(0)
    );

    // proposalState.proposal.amount.assertGte(
    //   feesPayedNow,
    //   'Amount transferred not enough to pay account creation fee'
    // );
    //TODO Enable after https://github.com/o1-labs/snarkyjs/issues/636 is closed

    Circuit.log(
      'accountCreationFeePaid Before',
      proposalState.accountCreationFeePaid
    );

    proposalState.accountCreationFeePaid =
      proposalState.accountCreationFeePaid.or(feesPayedNow.gt(UInt64.from(0)));
    this.balance.subInPlace(feesPayedNow);

    let feeSubAmount = Circuit.if(
      proposalState.accountCreationFeePaid,
      Mina.accountCreationFee(),
      UInt64.from(0)
    );

    let amount = Circuit.if(
      votesReached,
      proposalState.proposal.amount,
      // .sub(
      //     feeSubAmount
      // )
      UInt64.from(0)
    );

    this.self.send({ to: proposalState.proposal.receiver, amount });

    let newProposalTreeValue = Circuit.if(
      votesReached.or(
        votesAgainst.gt(this.numSigners.get().sub(this.signerThreshold.get()))
      ),
      MerkleMapUtils.EMPTY_VALUE,
      proposalState.hash()
    );

    let newRoot = MerkleMapUtils.computeRoot(
      proposalWitness,
      proposalState.index,
      newProposalTreeValue
    );

    this.proposalRoot.set(newRoot);

    this.emitEvent(
      'voted',
      new VotedEvent({
        signer: signer,
        vote: vote,
        proposal: proposalState.proposal,
        index: proposalState.index,
      })
    );
  }
}
