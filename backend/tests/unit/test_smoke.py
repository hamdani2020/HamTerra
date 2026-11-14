import os


def test_dummy_environment_is_applied() -> None:
    assert os.environ["AGRO_API_KEY"] == "dummy-agro-key"
