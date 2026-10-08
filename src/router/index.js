// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '../features/projects/DashboardView.vue'
import ProjectsView from '../features/projects/ProjectsView.vue'
import ProjectReviewView from '../features/review/ProjectReviewView.vue'
import InfoView from '../features/help/InfoView.vue'
import SettingsView from '../features/settings/SettingsView.vue'

const routes = [
  {
    path: '/',
    name: 'home',
    component: DashboardView
  },
  {
    path: '/projects',
    name: 'projects',
    component: ProjectsView
  },
  {
    path: '/projects/:id/review',
    name: 'projectReview',
    component: ProjectReviewView,
    props: true
  },
  {
    path: '/projects/:id',
    name: 'projectDetail',
    component: ProjectsView,
    props: true
  },
  {
    path: '/info',
    name: 'info',
    component: InfoView
  },
  {
    path: '/settings',
    name: 'settings',
    component: SettingsView
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
