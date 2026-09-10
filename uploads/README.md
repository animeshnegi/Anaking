# uploads/

Runtime uploads, all git-ignored:

- `voice/` — respondent voice recordings (`<study>__<code>_<qid>.webm`). Override with `VOICE_DIR`.
- `narration/<study>/` — narration clips uploaded from the Studio for walkthrough scenes
  (`<clip-id>.mp3|m4a|ogg|wav`). Override with `NARRATION_DIR`.

- `media/<study>/` — images and video attached to questions from the Studio (`m_xxxxxxxx.<ext>`), served publicly at `/media/<study>/<file>`.
