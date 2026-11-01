// Jenkins pipeline for the Hostel Food Rating API.
//
//   Checkout -> Install -> Lint -> Test -> Package -> Docker image
//
// Triggered by SCM polling every minute (a laptop Jenkins can't receive GitHub webhooks).
// The Test stage runs the pytest suite BEFORE packaging; Package builds the wheel, sdist and the
// executable .pyz with scripts/build_artifact.sh and archives them in the job view; the Docker
// image and the .pyz are versioned with the Jenkins build number and the Git commit SHA.
// Runs on the Jenkins defined in jenkins/ (Python 3.12 and the Docker CLI are preinstalled).

pipeline {
    agent any

    triggers {
        pollSCM('* * * * *')
    }

    options {
        skipDefaultCheckout(true)
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
        // A cold Docker build compiles psycopg and can take most of an hour on a slow connection.
        timeout(time: 75, unit: 'MINUTES')
    }

    environment {
        IMAGE = 'hostel-food-rating-api'
        PIP_DISABLE_PIP_VERSION_CHECK = '1'
    }

    stages {
        stage('Checkout') {
            steps {
                script {
                    def scmVars = checkout scm
                    env.GIT_COMMIT = scmVars.GIT_COMMIT
                    env.SHORT_SHA = scmVars.GIT_COMMIT.take(7)
                    env.VERSION_TAG = "b${env.BUILD_NUMBER}-${env.SHORT_SHA}"
                }
                echo "Building commit ${env.GIT_COMMIT} as ${env.VERSION_TAG}"
            }
        }

        stage('Install') {
            steps {
                sh '''
                    python3.12 -m venv --clear .venv
                    .venv/bin/pip install --quiet --upgrade pip
                    .venv/bin/pip install --quiet -r requirements-dev.txt
                '''
            }
        }

        stage('Lint') {
            steps {
                sh '.venv/bin/ruff check . && .venv/bin/ruff format --check .'
            }
        }

        stage('Test') {
            steps {
                sh '''
                    mkdir -p reports
                    .venv/bin/python -m pytest \
                        --junitxml=reports/junit.xml \
                        --cov=app --cov-report=term --cov-report=xml:reports/coverage.xml \
                        --cov-fail-under=85
                '''
            }
            post {
                always {
                    junit 'reports/junit.xml'
                }
            }
        }

        stage('Package') {
            steps {
                sh 'ARTIFACT_SUFFIX="$VERSION_TAG" PYTHON=.venv/bin/python bash scripts/build_artifact.sh'
            }
            post {
                success {
                    archiveArtifacts artifacts: 'dist/*', fingerprint: true
                }
            }
        }

        stage('Docker image') {
            steps {
                sh '''
                    docker build \
                        --build-arg VERSION="$VERSION_TAG" \
                        --build-arg VCS_REF="$GIT_COMMIT" \
                        -t "$IMAGE:$VERSION_TAG" .
                    docker run --rm --entrypoint python "$IMAGE:$VERSION_TAG" \
                        -c "import app.main; print('image OK: app imports')"
                    docker image ls "$IMAGE"
                '''
            }
        }
    }

    post {
        success {
            echo "Artifacts: dist/hostel-food-api-*-${env.VERSION_TAG}.pyz (+ wheel, sdist). Image: ${env.IMAGE}:${env.VERSION_TAG}"
        }
    }
}
