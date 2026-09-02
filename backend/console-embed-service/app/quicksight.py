"""Thin wrapper around the one boto3 call this service needs.

Both embed modes go through the same QuickSight API —
GenerateEmbedUrlForRegisteredUser — just with a different
ExperienceConfiguration. See docs/quicksight-console-embedding/README.md
for what has to be true on the AWS side for the console mode to actually
grant authoring capability (the user's QuickSight role, not this code, is
what enforces that).
"""

from functools import lru_cache

import boto3
from botocore.exceptions import ClientError
from fastapi import HTTPException

from .config import Settings, get_settings


@lru_cache
def _client():
    settings = get_settings()
    return boto3.client("quicksight", region_name=settings.aws_region)


def _generate_embed_url(experience_configuration: dict, settings: Settings) -> str:
    try:
        response = _client().generate_embed_url_for_registered_user(
            AwsAccountId=settings.aws_account_id,
            UserArn=settings.quicksight_user_arn,
            SessionLifetimeInMinutes=settings.session_lifetime_minutes,
            AllowedDomains=settings.allowed_domains,
            ExperienceConfiguration=experience_configuration,
        )
    except ClientError as e:
        # Most common causes here: the IAM role can't
        # GenerateEmbedUrlForRegisteredUser for this user ARN, or the
        # QuickSight user's role doesn't support the requested experience
        # (e.g. a Reader requesting the Console experience) — both are
        # config problems on the AWS side, not bugs in this service, so
        # surface the real message rather than a generic 500.
        raise HTTPException(status_code=502, detail=str(e)) from e
    return response["EmbedUrl"]


def get_dashboard_embed_url(settings: Settings) -> str:
    return _generate_embed_url(
        {"Dashboard": {"InitialDashboardId": settings.dashboard_id}},
        settings,
    )


def get_console_embed_url(settings: Settings) -> str:
    return _generate_embed_url(
        {"QuickSightConsole": {"InitialPath": f"/dashboards/{settings.dashboard_id}"}},
        settings,
    )
