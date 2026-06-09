-- trademark_blocks.block_count 증가 함수
CREATE OR REPLACE FUNCTION increment_block_count(kw TEXT)
RETURNS void AS $$
BEGIN
  UPDATE trademark_blocks
  SET block_count = block_count + 1
  WHERE lower(keyword) = lower(kw);
END;
$$ LANGUAGE plpgsql;
