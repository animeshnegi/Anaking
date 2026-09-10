"""
HTTP routes, one module per app:

    routes/home.py      /              landing page + legacy redirects
    routes/survey.py    /survey/...    respondent-facing survey + /api/*
    routes/studio.py    /studio/       survey builder           + /api/studio/*
    routes/admin.py     /admin/        dashboard, exports       + /api/admin/*

Routes stay thin: persistence lives in ``models.py``, computation in ``core/``.
"""

from .admin import bp as admin_bp
from .home import bp as home_bp
from .studio import bp as studio_bp
from .survey import bp as survey_bp

ALL_BLUEPRINTS = (home_bp, survey_bp, studio_bp, admin_bp)


def register_routes(app) -> None:
    for bp in ALL_BLUEPRINTS:
        app.register_blueprint(bp)
