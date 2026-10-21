EXPERIMENT_NAMESPACE = "llamaindex-exp"


class UnsafeTargetError(Exception):
    pass


# Called before anything touches Pinecone. Production vectors live in the
# default namespace, and the prod index must never see experiment writes.
def check_safe_target(index_name: str, namespace: str, environment: str) -> None:
    if environment != "dev":
        raise UnsafeTargetError(
            f"Refusing to run with ENVIRONMENT = {environment!r}; only 'dev' is allowed."
        )
    if not index_name or "prod" in index_name.lower():
        raise UnsafeTargetError(f"Refusing to use Pinecone index {index_name!r}.")
    if namespace != EXPERIMENT_NAMESPACE:
        raise UnsafeTargetError(
            f"Refusing namespace {namespace!r}; only {EXPERIMENT_NAMESPACE!r} is allowed."
        )
