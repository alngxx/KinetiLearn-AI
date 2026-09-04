from worker.processing import MD_MIME, extract_text


def test_extract_text_markdown_returns_decoded_source():
    text = extract_text(MD_MIME, b"# Title\n\ntext")
    assert text == "# Title\n\ntext"
