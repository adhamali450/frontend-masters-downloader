export interface CourseInput {
  title: string;
  url: string;
}

export interface Lesson {
  title: string;
  url: string;
  index: number;
  description?: string;
  chapterTitle?: string;
}   

export interface Chapter {
  title: string;
  index: number;
  lessons: Lesson[];
}

export interface Course {
  title: string;
  url: string;
  chapters: Chapter[];
}
