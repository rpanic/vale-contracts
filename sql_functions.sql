SELECT failure_reason FROM "user_commands";

CREATE USER archive_reader WITH PASSWORD 'reader';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO archive_reader;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO archive_reader;

create role authenticator noinherit login password 'authenticator123';

CREATE ROLE archive_reader_role nologin;
grant archive_reader_role to authenticator;

grant usage on schema public to archive_reader_role;
grant select on all tables in schema public to archive_reader_role;
grant usage, select on all sequences in schema public to archive_reader_role;


/* Fix archive schema */
CREATE TYPE zkapp_authorization_kind_type AS ENUM ('proof','signature','none_given');

ALTER TABLE zkapp_account_update ADD COLUMN authorization_kind zkapp_authorization_kind_type NOT NULL;

/*Get events*/

CREATE OR REPLACE FUNCTION getEvents(input_pk text)
RETURNS TABLE(txid text, auid integer, fields text[])
AS $$
SELECT hash, auid, array_agg(sd.field) fields FROM
    (SELECT sda.element_ids arr, c.hash hash, au.id auid
    FROM zkapp_commands c
            JOIN zkapp_account_update au ON au.id = ANY(c.zkapp_account_updates_ids)
            JOIN zkapp_account_update_body aub on au.body_id = aub.id
            JOIN account_identifiers ai ON aub.account_identifier_id = ai.id
            JOIN public_keys pk ON ai.public_key_id = pk.id
            JOIN zkapp_events e on aub.events_id = e.id
            JOIN zkapp_state_data_array sda on sda.id = ANY(e.element_ids)

    WHERE pk.value = 'B62qpCrewPVGPYAX3PQgUjj2hWaxmhxRPhgtAHaQwDzqQd3pba8M2Cq'
    GROUP BY c.hash, au.id, sda.id) a, unnest(a.arr) b
JOIN zkapp_state_data sd on sd.id = b
GROUP BY hash, auid
;
$$
LANGUAGE sql;


SELECT * FROM getEvents('B62qpCrewPVGPYAX3PQgUjj2hWaxmhxRPhgtAHaQwDzqQd3pba8M2Cq');

/*Get tx details*/
CREATE OR REPLACE FUNCTION getBlock(input_pk text)
RETURNS TABLE(command_hash text, balancechange integer, height integer, block_hash text, fee text, type text)
AS $$
SELECT c.hash command_hash, SUM(aub.balance_change::INTEGER) balancechange, b.height height, b.state_hash block_hash, zfpb.fee fee, 'ZKAPP_COMMAND' as type
FROM zkapp_commands c
         JOIN blocks_zkapp_commands bc ON bc.zkapp_command_id = c.id
         JOIN blocks b ON b.id = bc.block_id
         JOIN zkapp_account_update au ON au.id = ANY(c.zkapp_account_updates_ids)
         JOIN zkapp_account_update_body aub on au.body_id = aub.id
         JOIN account_identifiers ai ON aub.account_identifier_id = ai.id
         JOIN public_keys pk ON ai.public_key_id = pk.id
         JOIN zkapp_fee_payer_body zfpb on c.zkapp_fee_payer_body_id = zfpb.id

WHERE pk.value = input_pk
GROUP BY c.hash, b.height, b.state_hash, zfpb.fee
UNION
SELECT c.hash command_hash, c.amount::INTEGER balancechange, b.height height, b.state_hash block_hash, c.fee fee, 'USER_COMMAND' as type
FROM user_commands c
         JOIN account_identifiers ai on c.receiver_id = ai.id
         JOIN public_keys pk on ai.public_key_id = pk.id
         JOIN blocks_user_commands bc ON bc.user_command_id = c.id
         JOIN blocks b ON b.id = bc.block_id
WHERE pk.value = input_pk

;
$$ LANGUAGE sql;

SELECT * FROM getBlock('B62qpCrewPVGPYAX3PQgUjj2hWaxmhxRPhgtAHaQwDzqQd3pba8M2Cq');


SELECT c.hash command_hash, c.amount::INTEGER balancechange, b.height height, b.state_hash block_hash, c.fee fee, 'USER_COMMAND' as type
FROM user_commands c
         JOIN account_identifiers ai on c.receiver_id = ai.id
         JOIN public_keys pk on ai.public_key_id = pk.id
         JOIN blocks_user_commands bc ON bc.user_command_id = c.id
         JOIN blocks b ON b.id = bc.block_id
WHERE pk.value = 'B62qpCrewPVGPYAX3PQgUjj2hWaxmhxRPhgtAHaQwDzqQd3pba8M2Cq'


CREATE OR REPLACE FUNCTION getCanonicalBlock(height_input integer)
RETURNS TABLE(state_hash text)
AS $$
WITH RECURSIVE chain AS (
  (SELECT b.state_hash, b.parent_id, b.id, b.creator_id, b.height FROM blocks b WHERE height = (select MAX(height) from blocks)
  ORDER BY timestamp ASC
  LIMIT 1)

  UNION ALL

  SELECT b.state_hash, b.parent_id, b.id, b.creator_id, b.height  FROM blocks b
  INNER JOIN chain
  ON b.id = chain.parent_id AND chain.id <> chain.parent_id
) SELECT c.state_hash FROM chain c
  WHERE c.height = height_input
;
$$
LANGUAGE sql;

SELECT * FROM getcanonicalblock(6161);
