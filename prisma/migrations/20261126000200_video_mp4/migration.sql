-- Existing and newly finalized WebM recordings use the same MP4 preparation queue.
UPDATE video_sessions SET state = 'processing' WHERE state = 'ready';
