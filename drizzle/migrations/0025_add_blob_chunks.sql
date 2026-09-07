CREATE TABLE `blob_chunks` (
	`key` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`content_type` text,
	`data` blob NOT NULL,
	`created_at` integer NOT NULL
);

CREATE UNIQUE INDEX `blob_chunks_key_chunk_idx`
ON `blob_chunks` (`key`, `chunk_index`);
